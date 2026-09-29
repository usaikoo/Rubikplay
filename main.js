import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- Constants ----------

// One entry per face direction: outward normal + sticker colour.
const FACES = [
	{ n: new THREE.Vector3(1, 0, 0), color: 0xd62828 },  // R  red
	{ n: new THREE.Vector3(-1, 0, 0), color: 0xff7b00 }, // L  orange
	{ n: new THREE.Vector3(0, 1, 0), color: 0xf5f5f5 },  // U  white
	{ n: new THREE.Vector3(0, -1, 0), color: 0xffd500 }, // D  yellow
	{ n: new THREE.Vector3(0, 0, 1), color: 0x2ba84a },  // F  green
	{ n: new THREE.Vector3(0, 0, -1), color: 0x1e5bd8 }, // B  blue
];
const AXES = ['x', 'y', 'z'];
const AXIS_VECTORS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

// Face-turn keys: axis, which outer layer (+1 / -1), and the rotation sign for a clockwise turn.
const KEY_MOVES = {
	KeyR: { axis: 'x', side: 1, cw: -1 },
	KeyL: { axis: 'x', side: -1, cw: 1 },
	KeyU: { axis: 'y', side: 1, cw: -1 },
	KeyD: { axis: 'y', side: -1, cw: 1 },
	KeyF: { axis: 'z', side: 1, cw: -1 },
	KeyB: { axis: 'z', side: -1, cw: 1 },
};

const TURN_MS = 180;
const SCRAMBLE_TURN_MS = 60;
const DRAG_THRESHOLD = 10;

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);
const ui = {
	stage: $('stage'),
	moves: $('moves'),
	time: $('time'),
	best: $('best'),
	size: $('size'),
	scramble: $('scramble'),
	undo: $('undo'),
	reset: $('reset'),
	toast: $('toast'),
	win: $('win'),
	winText: $('winText'),
	again: $('again'),
	help: $('help'),
	helpBtn: $('helpBtn'),
	helpClose: $('helpClose'),
};

// ---------- Three.js setup ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
ui.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
const CAMERA_DIR = new THREE.Vector3(1, 0.85, 1.35).normalize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.8;

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f55, 1.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
fillLight.position.set(-6, -4, -5);
scene.add(fillLight);

const bodyGeo = new RoundedBoxGeometry(0.96, 0.96, 0.96, 3, 0.08);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x121318, roughness: 0.55, metalness: 0.1 });
const stickerGeo = roundedSquare(0.8, 0.13);
const stickerMats = FACES.map((f) => new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.35 }));

function roundedSquare(size, r) {
	const h = size / 2;
	const s = new THREE.Shape();
	s.moveTo(-h + r, -h);
	s.lineTo(h - r, -h);
	s.quadraticCurveTo(h, -h, h, -h + r);
	s.lineTo(h, h - r);
	s.quadraticCurveTo(h, h, h - r, h);
	s.lineTo(-h + r, h);
	s.quadraticCurveTo(-h, h, -h, h - r);
	s.lineTo(-h, -h + r);
	s.quadraticCurveTo(-h, -h, -h + r, -h);
	return new THREE.ShapeGeometry(s, 4);
}

// ---------- Game state ----------

const state = {
	n: 3,
	cubies: [],
	stickers: [],
	pickables: [],
	queue: [],
	anim: null,
	history: [],
	moves: 0,
	scrambling: false,
	scrambled: false,
	timerStart: 0,
	timerEnd: 0,
};

function half() {
	return (state.n - 1) / 2;
}

function build(n) {
	for (const c of state.cubies) scene.remove(c);
	state.cubies = [];
	state.stickers = [];
	state.pickables = [];
	state.queue = [];
	state.anim = null;
	state.n = n;

	const h = half();
	const p = new THREE.Vector3();
	for (let x = 0; x < n; x++) {
		for (let y = 0; y < n; y++) {
			for (let z = 0; z < n; z++) {
				p.set(x - h, y - h, z - h);
				// Skip hidden interior pieces.
				if (Math.abs(p.x) < h && Math.abs(p.y) < h && Math.abs(p.z) < h) continue;

				const cubie = new THREE.Group();
				cubie.position.copy(p);

				const body = new THREE.Mesh(bodyGeo, bodyMat);
				cubie.add(body);
				state.pickables.push(body);

				FACES.forEach((face, i) => {
					if (Math.abs(p.dot(face.n) - h) > 1e-6) return;
					const sticker = new THREE.Mesh(stickerGeo, stickerMats[i]);
					sticker.position.copy(face.n).multiplyScalar(0.485);
					sticker.quaternion.setFromUnitVectors(AXIS_VECTORS.z, face.n);
					sticker.userData = { sticker: true, normal: face.n.clone(), color: i };
					cubie.add(sticker);
					state.stickers.push(sticker);
					state.pickables.push(sticker);
				});

				scene.add(cubie);
				state.cubies.push(cubie);
			}
		}
	}
	fitCamera(true);
}

function fitCamera(resetDirection) {
	const aspect = camera.aspect || 1;
	const dist = (state.n * 2.4 + 2.2) * Math.max(1, 0.95 / aspect);
	const dir = resetDirection ? CAMERA_DIR.clone() : camera.position.clone().normalize();
	camera.position.copy(dir.multiplyScalar(dist));
	controls.minDistance = state.n * 1.4;
	controls.maxDistance = dist * 2.5;
	controls.target.set(0, 0, 0);
	controls.update();
}

// ---------- Moves & animation ----------

// A move rotates every cubie whose `axis` coordinate equals `layer` by dir * 90° around +axis.
function enqueue(move) {
	state.queue.push(move);
	startNext();
}

function startNext() {
	if (state.anim || !state.queue.length) return;
	const move = state.queue.shift();
	const pivot = new THREE.Object3D();
	scene.add(pivot);
	const group = state.cubies.filter((c) => Math.abs(c.position[move.axis] - move.layer) < 0.01);
	for (const c of group) pivot.attach(c);
	state.anim = {
		move,
		pivot,
		group,
		t0: performance.now(),
		dur: move.fast ? SCRAMBLE_TURN_MS : TURN_MS,
	};
}

function stepAnim(now, force = false) {
	const a = state.anim;
	if (!a) return;
	const t = force ? 1 : Math.min(1, (now - a.t0) / a.dur);
	const eased = 1 - Math.pow(1 - t, 3);
	a.pivot.rotation[a.move.axis] = a.move.dir * (Math.PI / 2) * eased;
	if (t < 1) return;

	a.pivot.updateMatrixWorld(true);
	for (const c of a.group) {
		scene.attach(c);
		snap(c);
	}
	scene.remove(a.pivot);
	state.anim = null;
	afterMove(a.move);
	startNext();
}

// Remove floating-point drift so positions stay on the grid and rotations stay at right angles.
const snapMatrix = new THREE.Matrix4();
function snap(obj) {
	obj.position.set(
		Math.round(obj.position.x * 2) / 2,
		Math.round(obj.position.y * 2) / 2,
		Math.round(obj.position.z * 2) / 2,
	);
	snapMatrix.makeRotationFromQuaternion(obj.quaternion);
	const e = snapMatrix.elements;
	for (let i = 0; i < 16; i++) e[i] = Math.round(e[i]);
	obj.quaternion.setFromRotationMatrix(snapMatrix);
}

function finishAllMoves() {
	while (state.anim) stepAnim(0, true);
}

function afterMove(move) {
	if (move.last) {
		state.scrambling = false;
		state.scrambled = true;
		resetStats();
		setButtons();
		toast('Scrambled! Your time starts on your first move');
		return;
	}
	if (!move.user) return;

	if (!move.undo) state.history.push(move);
	if (state.scrambled) state.moves++;
	updateStats();
	setButtons();

	if (state.scrambled && !state.anim && !state.queue.length && isSolved()) onSolved();
}

function isSolved() {
	const faceColor = {};
	const v = new THREE.Vector3();
	for (const s of state.stickers) {
		v.copy(s.userData.normal).applyQuaternion(s.parent.quaternion).round();
		const k = `${v.x},${v.y},${v.z}`;
		if (faceColor[k] === undefined) faceColor[k] = s.userData.color;
		else if (faceColor[k] !== s.userData.color) return false;
	}
	return true;
}

function onSolved() {
	state.scrambled = false;
	state.timerEnd = performance.now();
	const ms = state.timerEnd - state.timerStart;
	updateStats();

	const bestKey = `muddle-best-${state.n}`;
	const prev = storageGet(bestKey);
	const isRecord = !prev || ms < Number(prev);
	if (isRecord) storageSet(bestKey, String(Math.round(ms)));
	showBest();

	ui.winText.textContent = `${state.n}×${state.n} solved in ${state.moves} ${state.moves === 1 ? 'move' : 'moves'} and ${formatTime(ms)}.` +
		(isRecord ? ' New best time!' : '');
	setTimeout(() => ui.win.classList.remove('hidden'), 350);
}

// ---------- Actions ----------

function layers() {
	const h = half();
	const out = [];
	for (let i = 0; i < state.n; i++) out.push(i - h);
	return out;
}

function scramble() {
	ui.win.classList.add('hidden');
	build(state.n);
	resetStats();
	state.scrambling = true;
	state.scrambled = false;
	state.history = [];
	setButtons();

	const count = state.n === 2 ? 14 : state.n * 8;
	const ls = layers();
	let prev = null;
	for (let i = 0; i < count; i++) {
		let move;
		do {
			move = {
				axis: AXES[Math.floor(Math.random() * 3)],
				layer: ls[Math.floor(Math.random() * ls.length)],
				dir: Math.random() < 0.5 ? 1 : -1,
				fast: true,
			};
		} while (prev && prev.axis === move.axis && prev.layer === move.layer);
		prev = move;
		if (i === count - 1) move.last = true;
		enqueue(move);
	}
}

function reset() {
	ui.win.classList.add('hidden');
	state.scrambling = false;
	state.scrambled = false;
	state.history = [];
	build(state.n);
	resetStats();
	setButtons();
}

function undo() {
	if (state.scrambling || !state.history.length) return;
	const last = state.history.pop();
	enqueue({ axis: last.axis, layer: last.layer, dir: -last.dir, user: true, undo: true });
	setButtons();
}

function userMove(axis, layer, dir) {
	if (state.scrambling) return;
	if (state.scrambled && !state.timerStart) state.timerStart = performance.now();
	enqueue({ axis, layer, dir, user: true });
}

// ---------- Pointer interaction ----------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function pick(e) {
	const r = renderer.domElement.getBoundingClientRect();
	ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(ndc, camera);
	const hits = raycaster.intersectObjects(state.pickables, false);
	if (!hits.length) return null;

	const hit = hits[0];
	const cubie = hit.object.parent;
	const normal = hit.object.userData.sticker
		? hit.object.userData.normal.clone().applyQuaternion(cubie.quaternion)
		: hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
	snapToAxis(normal);

	// Only faces on the outside of the cube can be dragged.
	if (Math.abs(cubie.position.dot(normal) - half()) > 0.01) return null;
	return { cubie, normal, point: hit.point.clone() };
}

function snapToAxis(v) {
	const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
	if (ax >= ay && ax >= az) v.set(Math.sign(v.x), 0, 0);
	else if (ay >= az) v.set(0, Math.sign(v.y), 0);
	else v.set(0, 0, Math.sign(v.z));
	return v;
}

function toScreen(v) {
	const p = v.clone().project(camera);
	const r = renderer.domElement.getBoundingClientRect();
	return new THREE.Vector2((p.x * r.width) / 2, (-p.y * r.height) / 2);
}

// Capture phase so this runs before OrbitControls and can switch it off for sticker drags.
ui.stage.addEventListener('pointerdown', (e) => {
	if (state.scrambling || (e.pointerType === 'mouse' && e.button !== 0)) return;
	finishAllMoves();
	const hit = pick(e);
	if (!hit) return;
	controls.enabled = false;
	drag = { ...hit, x: e.clientX, y: e.clientY, id: e.pointerId };
}, true);

window.addEventListener('pointermove', (e) => {
	if (!drag || e.pointerId !== drag.id) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

	// Of the two directions lying in the touched face, pick the one whose on-screen
	// direction best matches the drag.
	const origin = toScreen(drag.point);
	let best = null;
	for (const name of AXES) {
		const t = AXIS_VECTORS[name];
		if (Math.abs(t.dot(drag.normal)) > 0.5) continue;
		const s = toScreen(drag.point.clone().add(t)).sub(origin).normalize();
		const d = (s.x * dx + s.y * dy) / Math.hypot(dx, dy);
		if (!best || Math.abs(d) > Math.abs(best.d)) best = { t, d };
	}

	// Rotating around (normal × dragDirection) moves the touched sticker along the drag.
	const dragDir = best.t.clone().multiplyScalar(Math.sign(best.d));
	const rotAxis = snapToAxis(new THREE.Vector3().crossVectors(drag.normal, dragDir));
	const axis = rotAxis.x ? 'x' : rotAxis.y ? 'y' : 'z';
	userMove(axis, drag.cubie.position[axis], rotAxis[axis]);
	drag = null;
});

function endDrag() {
	drag = null;
	controls.enabled = true;
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------- Keyboard ----------

window.addEventListener('keydown', (e) => {
	if (e.target.tagName === 'SELECT') return;
	if (e.key === 'Escape') {
		ui.help.classList.add('hidden');
		ui.win.classList.add('hidden');
		return;
	}
	if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
		e.preventDefault();
		undo();
		return;
	}
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	const m = KEY_MOVES[e.code];
	if (!m) return;
	e.preventDefault();
	userMove(m.axis, m.side * half(), e.shiftKey ? -m.cw : m.cw);
});

// ---------- UI ----------

function formatTime(ms) {
	const totalTenths = Math.floor(ms / 100);
	const tenths = totalTenths % 10;
	const secs = Math.floor(totalTenths / 10) % 60;
	const mins = Math.floor(totalTenths / 600);
	return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function resetStats() {
	state.moves = 0;
	state.timerStart = 0;
	state.timerEnd = 0;
	updateStats();
}

function updateStats() {
	ui.moves.textContent = state.moves;
	let ms = 0;
	if (state.timerStart) ms = (state.timerEnd || performance.now()) - state.timerStart;
	ui.time.textContent = formatTime(ms);
}

function showBest() {
	const best = storageGet(`muddle-best-${state.n}`);
	ui.best.textContent = best ? formatTime(Number(best)) : '—';
}

function setButtons() {
	ui.undo.disabled = state.scrambling || !state.history.length;
	ui.scramble.disabled = state.scrambling;
	ui.reset.disabled = state.scrambling;
	ui.size.disabled = state.scrambling;
}

let toastTimer = 0;
function toast(msg) {
	ui.toast.textContent = msg;
	ui.toast.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2400);
}

function storageGet(key) {
	try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
	try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

ui.scramble.addEventListener('click', scramble);
ui.reset.addEventListener('click', reset);
ui.undo.addEventListener('click', undo);
ui.again.addEventListener('click', scramble);
ui.helpBtn.addEventListener('click', () => ui.help.classList.remove('hidden'));
ui.helpClose.addEventListener('click', () => ui.help.classList.add('hidden'));
ui.size.addEventListener('change', () => {
	state.n = Number(ui.size.value);
	reset();
	showBest();
});

// ---------- Resize & loop ----------

function resize() {
	const w = ui.stage.clientWidth;
	const h = ui.stage.clientHeight;
	renderer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	fitCamera(false);
}
window.addEventListener('resize', resize);

renderer.setAnimationLoop((now) => {
	stepAnim(now);
	if (state.timerStart && !state.timerEnd) updateStats();
	controls.update();
	renderer.render(scene, camera);
});

// ---------- Start ----------

build(state.n);
resize();
showBest();
setButtons();
if (!storageGet('muddle-seen-help')) {
	ui.help.classList.remove('hidden');
	storageSet('muddle-seen-help', '1');
}
