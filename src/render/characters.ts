/**
 * DESIGN §4.2 — the hero, still built from primitives (the troll is a Blender model, see models.ts). All models face +X in local space;
 * set `rotation.y = -angle` to face a grid angle (grid y maps to world z).
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, type Material } from 'three';
import { CHARACTER as K } from './palette';
import { glow, toon } from './materials';

function mesh(geo: ConstructorParameters<typeof Mesh>[0], mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------------------
// Hero: small, blond, pointy ears, green tunic, deep red cape.

export class HeroModel {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly cape: Group;
  private readonly legs: Mesh[];
  private readonly sword: Group;
  private walkT = 0;

  constructor() {
    const skin = toon(K.skin);
    const hair = toon(K.hair);
    this.legs = [-0.07, 0.07].map((z) => mesh(new BoxGeometry(0.08, 0.14, 0.08), toon(K.boots), 0, 0.07, z));
    this.body.add(...this.legs);
    this.body.add(mesh(new CylinderGeometry(0.13, 0.19, 0.26, 8), toon(K.tunic), 0, 0.26, 0));
    this.body.add(mesh(new CylinderGeometry(0.135, 0.135, 0.04, 8), toon(K.belt), 0, 0.24, 0));
    this.body.add(mesh(new SphereGeometry(0.15, 10, 8), skin, 0.01, 0.5, 0));
    // hair cap + bangs
    const cap = mesh(new SphereGeometry(0.162, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, -0.015, 0.515, 0);
    this.body.add(cap);
    for (const z of [-0.08, 0, 0.08]) {
      const bang = mesh(new ConeGeometry(0.045, 0.11, 4), hair, 0.12, 0.58, z);
      bang.rotation.z = -2.3;
      this.body.add(bang);
    }
    // pointy ears
    for (const s of [-1, 1]) {
      const ear = mesh(new ConeGeometry(0.035, 0.16, 4), skin, -0.02, 0.51, s * 0.17);
      ear.rotation.x = s * 1.25;
      this.body.add(ear);
    }
    for (const z of [-0.055, 0.055]) this.body.add(mesh(new BoxGeometry(0.02, 0.04, 0.025), toon('#1d1a2a'), 0.145, 0.5, z));
    // cape hangs from the shoulders, pivoting at the top
    this.cape = new Group();
    this.cape.position.set(-0.1, 0.42, 0);
    this.cape.add(mesh(new BoxGeometry(0.035, 0.36, 0.3), toon(K.cape), -0.02, -0.18, 0));
    this.body.add(this.cape);
    // sword (shown while swinging)
    this.sword = new Group();
    this.sword.position.set(0.05, 0.3, 0.16);
    this.sword.add(mesh(new BoxGeometry(0.34, 0.035, 0.035), glow(K.blade), 0.2, 0, 0));
    this.sword.add(mesh(new BoxGeometry(0.04, 0.03, 0.12), toon(K.belt), 0.03, 0, 0));
    this.sword.visible = false;
    this.body.add(this.sword);
    this.root.add(this.body);
  }

  update(dt: number, facing: number, moving: boolean, sneaking: boolean, swing: number): void {
    this.root.rotation.y = -facing;
    this.walkT += dt * (moving ? (sneaking ? 7 : 12) : 0);
    const s = Math.sin(this.walkT);
    this.legs[0].position.x = moving ? s * 0.05 : 0;
    this.legs[1].position.x = moving ? -s * 0.05 : 0;
    this.body.position.y = moving ? Math.abs(s) * 0.03 : 0;
    this.body.scale.y = sneaking ? 0.82 : 1;
    this.cape.rotation.z = moving ? -0.35 - Math.abs(s) * 0.15 : -0.05 + Math.sin(performance.now() / 600) * 0.03;
    this.sword.visible = swing > 0;
    this.sword.rotation.y = swing > 0 ? -1.4 + (1 - swing / 0.25) * 2.8 : 0;
  }
}
