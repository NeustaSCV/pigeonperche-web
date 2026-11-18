// Entrées clavier / souris avec verrouillage du pointeur. Les touches sont lues par position physique
// (event.code) : ZQSD sur un clavier AZERTY correspond à WASD sur un QWERTY.
// Les commandes tactiles (src/ui/touch.ts) passent par la même couche : touches virtuelles (vdown / vup / vpress),
// clics virtuels (vclick), deltas de visée (addLook), axes analogiques (axisX / axisY), clics de tourelle et zoom.
export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  dx = 0;
  dy = 0;
  wheel = 0;
  buttons = 0;
  private clicks = new Set<number>();
  locked = false;
  enabled = true;
  /** appareil tactile : pas de verrouillage du pointeur, la visée vient de addLook() */
  touch = false;
  /** tests automatisés : la souris est lue sans verrouillage du pointeur */
  free = false;
  /** vitesse du regard réglée par le joueur (menu de pause) : multiplie le déplacement de la souris et du doigt */
  sens = 1;
  /** manette analogique (tactile) : −1..1, x vers la droite, y vers l'avant */
  axisX = 0;
  axisY = 0;
  /** manette poussée à fond : course */
  run = false;
  /** clics de tourelle demandés par les boutons tactiles (unités de 0,1 mrad), remis à zéro en fin d'image */
  elevDelta = 0;
  windDelta = 0;
  /** facteur de grossissement demandé (boutons, pincement), 1 = inchangé */
  zoomMul = 1;
  private vkeys = new Set<string>();
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseVirtual(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.free) return;
      this.dx += e.movementX * this.sens;
      this.dy += e.movementY * this.sens;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.free) return;
      this.buttons |= 1 << e.button;
      this.clicks.add(e.button);
    });
    document.addEventListener('mouseup', (e) => (this.buttons &= ~(1 << e.button)));
    document.addEventListener('wheel', (e) => { if (this.locked || this.free) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.buttons = 0; this.keys.clear(); }
      this.onLockChange(this.locked);
    });
  }
  lock(): void {
    if (!this.locked && !this.touch) (this.el.requestPointerLock() as any)?.catch?.(() => {});
  }
  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }
  down(code: string): boolean {
    return this.enabled && (this.keys.has(code) || this.vkeys.has(code));
  }
  /** vrai une seule fois par appui */
  hit(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }
  /** appui détecté même hors jeu (menus) : ne manque pas les frappes plus courtes qu'une image */
  rawHit(code: string): boolean {
    return this.pressed.has(code);
  }
  click(button: number): boolean {
    return this.enabled && this.clicks.has(button);
  }
  /** à appeler en fin d'image */
  endFrame(): void {
    this.pressed.clear();
    this.clicks.clear();
    this.dx = this.dy = this.wheel = 0;
    this.elevDelta = this.windDelta = 0;
    this.zoomMul = 1;
  }
  // ---- commandes tactiles ----
  /** touche virtuelle tenue (bouton maintenu) */
  vdown(code: string): void {
    this.vkeys.add(code);
  }
  vup(code: string): void {
    this.vkeys.delete(code);
  }
  /** appui bref sur une touche virtuelle */
  vpress(code: string): void {
    this.pressed.add(code);
  }
  vclick(button: number): void {
    this.clicks.add(button);
  }
  /** déplacement du regard, en pixels équivalents souris */
  addLook(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.dx += dx * this.sens;
    this.dy += dy * this.sens;
  }
  /** relâche tout ce qui est tenu par le tactile (geste interrompu, perte de focus, changement d'écran) */
  releaseVirtual(): void {
    this.vkeys.clear();
    this.axisX = this.axisY = 0;
    this.run = false;
  }
  /** le joueur demande-t-il à se déplacer (clavier ou manette) ? */
  get wantsMove(): boolean {
    return this.enabled && (this.keys.has('KeyW') || this.keys.has('KeyA') || this.keys.has('KeyS') || this.keys.has('KeyD') || Math.hypot(this.axisX, this.axisY) > 0.2);
  }
  /** pour les tests automatisés */
  press(code: string): void {
    this.pressed.add(code);
  }
}
