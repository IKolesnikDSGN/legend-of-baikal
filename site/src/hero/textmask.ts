/**
 * Тёмная копия текста в дыре маски.
 *
 * Текст первого экрана лежит на кальке и набран вывороткой. Там, где маска
 * открыла кадр, под ним светлое небо, и выворотка на нём пропадает — значит в
 * дыре текст обязан быть вторым цветом. Форма дыры процедурная: её считает
 * шейдер по шуму, повторить её в CSS нечем.
 *
 * Поэтому маска снимается картинкой. Отдельный маленький канвас рисует ровно
 * ту же дыру (формула одна на оба шейдера — `MASK_GLSL`), кадр уходит в blob и
 * назначается копии текста как `mask-image`. Копию делает `cloneNode`, а не
 * вторая ветка разметки: две версии одного текста в шаблоне разъедутся на
 * первой же правке.
 *
 * Свой контекст, а не рендер-таргет основного: из готового канваса кадр
 * забирается сразу, а из таргета его пришлось бы тащить через readPixels,
 * то есть ждать GPU посреди кадра.
 *
 * Снимок стоит кодирования PNG, поэтому идёт не каждый кадр: маска движется
 * за курсором, и отставание на кадр-другой в ней не читается.
 *
 * **Копий текста две, и показана всегда одна.** Смена `mask-image` у видимого
 * слоя даёт кадр без маски: браузер снимает старую сразу, а новую ставит,
 * только когда та встанет в композицию, — и в эту щель тёмный текст вспыхивает
 * на весь экран. Ждать `decode()` мало, декодирование и композиция — разные
 * шаги. Поэтому новый снимок всегда назначается СКРЫТОЙ копии, и она меняется
 * с показанной через два кадра, когда маска на ней уже нарисована.
 */

import { MASK_FRAG, QUAD_VERT } from './shaders';

/** Во сколько раз снимок мельче экрана. Край дыры на 3 размывается на 2–3 px. */
const SCALE = 3;
/** Минимальный промежуток между снимками, мс. */
const PERIOD = 45;
/** Через сколько мс отпускать снимок, ушедший с экрана. */
const STALE = 400;

export type MaskUniforms = {
  aspect: number;
  blob: [number, number];
  radius: number;
  noiseAmp: number;
  maskTime: number;
  warp: number;
  edgeSoft: [number, number];
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`маска не собралась: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

export class TextMask {
  private canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private busy = false;
  private last = -1e9;
  /** какая из двух копий сейчас показана */
  private front = 0;
  /** адреса снимков, лежащих на копиях */
  private urls: (string | null)[] = [null, null];

  /**
   * @param noise тот же шум, что у сцены: своя копия текстуры в своём контексте,
   *              но картинка одна — иначе поле маски пошло бы по другому шуму.
   * @param targets две копии текста: показана всегда одна.
   */
  constructor(noise: TexImageSource, private targets: [HTMLElement, HTMLElement]) {
    // preserveDrawingBuffer: снимок берётся уже после кадра, без него буфер
    // к этому моменту очищен и в картинку уходит пустота
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error('нет контекста под маску текста');
    this.gl = gl;

    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, compile(gl, gl.VERTEX_SHADER, QUAD_VERT));
    gl.attachShader(this.prog, compile(gl, gl.FRAGMENT_SHADER, MASK_FRAG));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
      throw new Error(`маска не слинковалась: ${gl.getProgramInfoLog(this.prog)}`);
    }
    gl.useProgram(this.prog);

    // Полноэкранный треугольник: position идёт в клип-координатах, uv — 0..1,
    // ровно как ждёт QUAD_VERT сцены.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
      3, -1, 2, 0,
      -1, 3, 0, 2,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'position');
    const aUv = gl.getAttribLocation(this.prog, 'uv');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    for (const n of ['uAspect', 'uBlob', 'uRadius', 'uNoiseAmp', 'uMaskTime',
                     'uWarp', 'uEdgeSoft', 'uNoise']) {
      this.loc[n] = gl.getUniformLocation(this.prog, n);
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(this.loc.uNoise, 0);
  }

  resize(w: number, h: number) {
    const cw = Math.max(2, Math.round(w / SCALE));
    const ch = Math.max(2, Math.round(h / SCALE));
    if (this.canvas.width === cw && this.canvas.height === ch) return;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.gl.viewport(0, 0, cw, ch);
  }

  /** Кадр маски и, если пора, новый снимок. `on = false` снимает маску вовсе. */
  update(now: number, on: boolean, u: MaskUniforms) {
    if (!on) {
      if (this.urls[0] || this.urls[1]) this.clear();
      return;
    }
    if (this.busy || now - this.last < PERIOD) return;
    this.last = now;

    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform1f(this.loc.uAspect, u.aspect);
    gl.uniform2f(this.loc.uBlob, u.blob[0], u.blob[1]);
    gl.uniform1f(this.loc.uRadius, u.radius);
    gl.uniform1f(this.loc.uNoiseAmp, u.noiseAmp);
    gl.uniform1f(this.loc.uMaskTime, u.maskTime);
    gl.uniform1f(this.loc.uWarp, u.warp);
    gl.uniform2f(this.loc.uEdgeSoft, u.edgeSoft[0], u.edgeSoft[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.busy = true;
    this.canvas.toBlob((blob) => {
      if (!blob) {
        this.busy = false;
        return;
      }
      const next = URL.createObjectURL(blob);
      // Декодирование до назначения: без него браузер сначала снимет старую
      // маску, а новую поставит только после загрузки.
      const img = new Image();
      img.src = next;
      img.decode()
        .then(() => this.swap(next))
        .catch(() => URL.revokeObjectURL(next))
        .finally(() => {
          this.busy = false;
        });
    }, 'image/png');
  }

  /**
   * Снимок уходит на скрытую копию, и она подменяет показанную через два кадра.
   *
   * Два, а не один: в первом кадре маска только назначена, встаёт в композицию
   * она к следующему. Подмена раньше — та же вспышка, ради которой копий и
   * заведено две.
   */
  private swap(url: string) {
    const back = 1 - this.front;
    const el = this.targets[back];
    el.style.setProperty('-webkit-mask-image', `url(${url})`);
    el.style.setProperty('mask-image', `url(${url})`);
    const stale = this.urls[back];
    this.urls[back] = url;

    // Обещание держит `busy` до конца подмены. Без него следующий снимок
    // успевает выбрать ту же скрытую копию, пока `front` ещё не переставлен, и
    // вторая подмена гасит обе разом — текст пропадает на кадр.
    return new Promise<void>((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.opacity = '1';
        this.targets[this.front].style.opacity = '0';
        this.front = back;
        // адрес, ушедший с экрана, отпускается не сразу: он ещё нарисован
        if (stale) window.setTimeout(() => URL.revokeObjectURL(stale), STALE);
        done();
      }));
    });
  }

  /**
   * Убрать копии с экрана. Прозрачностью, а не снятием маски: слой без маски
   * виден целиком и показался бы вторым цветом поверх всего экрана.
   */
  private clear() {
    this.targets.forEach((el, i) => {
      el.style.opacity = '0';
      if (this.urls[i]) URL.revokeObjectURL(this.urls[i]!);
      this.urls[i] = null;
      el.style.removeProperty('-webkit-mask-image');
      el.style.removeProperty('mask-image');
    });
  }

  destroy() {
    this.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
