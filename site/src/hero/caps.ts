/**
 * Возможности устройства. ТЗ 2.8: фолбэки проектируются сразу.
 *
 * Решения принимаются один раз до инициализации, кроме качества — оно снижается
 * по замеру FPS за первые две секунды. Дёргать качество после этого нельзя:
 * скачок числа частиц посреди сцены заметнее низкого фреймрейта.
 */

export type Caps = {
  webgl: boolean;
  reduced: boolean;
  /** ограничен 1.75 (ТЗ 2.7): на 3× ретине fbm сажает батарею на глазах */
  dpr: number;
  /** ширина текстур плашек */
  tier: number;
  format: 'avif' | 'webp';
  /** сателлиты и полный рой — только если устройство держит кадр */
  quality: 'full' | 'lite';
  touch: boolean;
};

const DPR_MAX = 1.75;

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** AVIF примерно на треть меньше WebP, но decode дороже — проверяем поддержку. */
async function pickFormat(): Promise<'avif' | 'webp'> {
  const probe =
    'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.width === 2 ? 'avif' : 'webp');
    img.onerror = () => res('webp');
    img.src = probe;
  });
}

export async function detect(plateWidths: number[]): Promise<Caps> {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  const touch = matchMedia('(hover: none)').matches;

  // текстура должна покрывать видимый кадр, а видно из канваса только его долю,
  // поэтому нужная ширина считается по канвасу, а не по вьюпорту
  const need = window.innerWidth * dpr;
  const sorted = [...plateWidths].sort((a, b) => a - b);
  const tier = sorted.find((w) => w * 0.82 >= need) ?? sorted[sorted.length - 1];

  return {
    webgl: hasWebGL(),
    reduced,
    dpr,
    tier,
    format: await pickFormat(),
    quality: 'full',
    touch,
  };
}

/**
 * Замер среднего FPS за окно измерения. Возвращает промис с решением о качестве:
 * ниже 45 кадров — снимаем сателлиты и режем рой вдвое.
 */
export function probe(ms = 2000): Promise<'full' | 'lite'> {
  return new Promise((res) => {
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else res(frames / ((performance.now() - t0) / 1000) < 45 ? 'lite' : 'full');
    };
    requestAnimationFrame(tick);
  });
}
