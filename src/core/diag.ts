// Diagnostic à distance, en développement seulement : erreurs, étapes de chargement et capacités de l'appareil
// sont envoyées au serveur Vite (voir vite.config.ts), qui les écrit dans e2e/out/device.log. Sert à comprendre
// ce qui se passe sur un téléphone dont on ne voit pas la console.
const on = import.meta.env.DEV;
let seq = 0;

export function report(kind: string, data: unknown = ''): void {
  if (!on) return;
  try {
    const body = JSON.stringify({ n: seq++, t: Math.round(performance.now()), kind, data });
    void fetch('/__hr_log', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch { /* jamais bloquant */ }
}

/** Affiche une erreur à l'écran (le joueur sur téléphone n'a pas de console) et l'envoie au journal. */
export function showError(title: string, detail: string): void {
  report('error', `${title}\n${detail}`);
  let box = document.getElementById('hr-error');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'hr-error';
    box.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;max-height:70vh;overflow:auto;margin:0;padding:12px 14px;background:rgba(20,8,8,.92);color:#f3b0a0;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:999;border:1px solid #a4503c;pointer-events:auto';
    document.body.appendChild(box);
  }
  box.textContent += `${title}\n${detail}\n\n`;
}

export function installDiagnostics(): void {
  window.addEventListener('error', (e) => showError('Erreur', `${e.message}\n${e.filename}:${e.lineno}\n${e.error?.stack ?? ''}`));
  window.addEventListener('unhandledrejection', (e) => showError('Erreur (promesse)', String(e.reason?.stack ?? e.reason)));
  window.addEventListener('pagehide', () => report('pagehide'));
  if (!on) return;
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const info: Record<string, unknown> = {
    ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, inner: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio,
    touchPoints: navigator.maxTouchPoints, standalone: (navigator as any).standalone ?? null, memory: (navigator as any).deviceMemory ?? null, webgl2: !!gl,
  };
  if (gl) {
    info.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    info.maxArrayLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
    info.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    info.ext = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_float_blend', 'WEBGL_compressed_texture_astc'].filter((x) => !!gl.getExtension(x));
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) info.gpu = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  }
  report('device', info);
}
