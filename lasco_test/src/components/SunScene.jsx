import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { AU_KM } from '../lib/orbit.js'
import { createAsciiLayer } from '../lib/ascii.js'

// ── Escala de la escena (no real) ────────────────────────────────────────────────
// A escala real el Sol sería un punto: está a 215 radios solares de la Tierra y L1 a solo 1,5 M km de ella.
// Por eso: radio solar = 5, 1 UA = 70 y el entorno de la Tierra (SOHO, L1) ampliado con NEAR_SCALE.
const SUN_R = 5
const ORBIT_R = 70
const NEAR_SCALE = 10 / 1_500_000 // 1,5 M km (≈ distancia Tierra–L1) → 10 unidades
const ORBIT_FOV = 45
const LASCO_FOV = 50

// Eclíptica (x, y, z con z al norte) → escena de three.js (y hacia arriba), conservando la orientación.
const toScene = (v) => new THREE.Vector3(v[0], v[2], -v[1])

// Polo norte solar (IAU): AR 286,13°, Dec 63,87° (J2000 ecuatorial) → eclíptica → escena.
// Las imágenes de LASCO vienen con este norte hacia arriba, así que la cámara de la vista LASCO lo usa como "arriba".
function solarNorth() {
  const rad = THREE.MathUtils.degToRad
  const [a, d, e] = [rad(286.13), rad(63.87), rad(23.4392911)]
  const eq = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
  const ecl = [eq[0], eq[1] * Math.cos(e) + eq[2] * Math.sin(e), -eq[1] * Math.sin(e) + eq[2] * Math.cos(e)]
  return toScene(ecl).normalize()
}

const noiseGLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`

const sunVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

const sunFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  ${noiseGLSL}
  void main() {
    vec3 p = normalize(vPos) * 3.0;
    float plasma = fbm(p + vec3(uTime * 0.04, uTime * 0.025, -uTime * 0.03));
    float granules = fbm(p * 5.0 - uTime * 0.12);
    float spots = smoothstep(0.66, 0.74, fbm(p * 1.1 + 11.0));
    float heat = plasma * 0.6 + granules * 0.4;

    vec3 cool = vec3(0.70, 0.18, 0.02);
    vec3 warm = vec3(1.00, 0.58, 0.14);
    vec3 hot  = vec3(1.00, 0.93, 0.70);
    vec3 col = mix(cool, warm, smoothstep(0.25, 0.52, heat));
    col = mix(col, hot, smoothstep(0.52, 0.78, heat));

    // Oscurecimiento del limbo: el borde del disco se ve más tenue y rojizo.
    float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    col *= mix(0.35, 1.2, pow(mu, 0.5));
    col *= 1.0 - spots * 0.65;
    gl_FragColor = vec4(col, 1.0);
  }
`

function makeGlowTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0.0, 'rgba(255, 220, 150, 1)')
  g.addColorStop(0.2, 'rgba(255, 170, 60, 0.55)')
  g.addColorStop(0.45, 'rgba(255, 110, 20, 0.16)')
  g.addColorStop(1.0, 'rgba(255, 80, 0, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeLabel(text, className = '', offset = [0, 0, 0]) {
  const el = document.createElement('div')
  el.className = `scene-label ${className}`
  el.textContent = text
  const label = new CSS2DObject(el)
  label.position.set(...offset)
  return label
}

function makeSoho() {
  const group = new THREE.Group()
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a72c, metalness: 0.7, roughness: 0.35 })
  const panel = new THREE.MeshStandardMaterial({ color: 0x1d3f8f, metalness: 0.3, roughness: 0.5, emissive: 0x0a1630 })
  const white = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.6 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.5), gold)
  const wings = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.05, 0.9), panel)
  // El telescopio (LASCO) apunta por +z; `lookAt` orienta +z hacia el Sol.
  const lasco = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 16), white)
  lasco.rotation.x = Math.PI / 2
  lasco.position.set(0.25, 0.25, 1.1)
  group.add(body, wings, lasco)
  group.scale.setScalar(0.8)
  return group
}

function makeStars() {
  const count = 2500
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 300)
    positions.set([v.x, v.y, v.z], i * 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xbfc6d6, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.75 }),
  )
}

function buildScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  // Filtro ASCII: un canvas de texto encima del WebGL (que sigue recibiendo el mouse) y debajo de las etiquetas.
  const ascii = createAsciiLayer(container)

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'scene-labels'
  container.appendChild(labelRenderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  const camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.1, 5000)
  camera.position.set(-30, 45, 110)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.minDistance = 4
  controls.maxDistance = 600

  const stars = makeStars()
  scene.add(stars)
  scene.add(new THREE.AmbientLight(0xffffff, 0.12))
  scene.add(new THREE.PointLight(0xfff1dc, 3, 0, 0))

  // Sol: el pivote alinea el eje de rotación con el polo norte solar real.
  const north = solarNorth()
  const sunUniforms = { uTime: { value: 0 } }
  const sunPivot = new THREE.Group()
  sunPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), north)
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_R, 96, 96),
    new THREE.ShaderMaterial({ uniforms: sunUniforms, vertexShader: sunVertex, fragmentShader: sunFragment }),
  )
  sunPivot.add(sun)
  scene.add(sunPivot)
  const glowTex = makeGlowTexture()
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  )
  glow.scale.setScalar(SUN_R * 5.5)
  scene.add(glow)
  const sunLabel = makeLabel('sol', '', [0, SUN_R + 1.6, 0])
  scene.add(sunLabel)

  // Órbita terrestre
  const orbitPts = Array.from({ length: 256 }, (_, i) => {
    const a = (i / 256) * Math.PI * 2
    return new THREE.Vector3(Math.cos(a) * ORBIT_R, 0, Math.sin(a) * ORBIT_R)
  })
  const orbitLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0x1f4a2a, transparent: true, opacity: 0.9 }),
  )
  scene.add(orbitLine)

  // Tierra
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.8, emissive: 0x071530 }),
  )
  const earthLabel = makeLabel('tierra', '', [0, 2.4, 0])
  earth.add(earthLabel)
  scene.add(earth)

  // Línea Sol–Tierra
  const sunEarthLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
    new THREE.LineDashedMaterial({ color: 0x4f8a5c, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.7 }),
  )
  scene.add(sunEarthLine)

  // Punto de Lagrange L1
  const l1 = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshBasicMaterial({ color: 0x7fbf8a, wireframe: true }),
  )
  const l1Label = makeLabel('L1', 'scene-label--muted', [0, 1.2, 0])
  l1.add(l1Label)
  scene.add(l1)

  // Trayectoria (órbita halo) y SOHO
  const trail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.85 }),
  )
  scene.add(trail)

  const soho = makeSoho()
  // Debajo de la nave, para no chocar con la etiqueta de la Tierra (que va encima).
  // El desplazamiento es local: el grupo de SOHO está escalado.
  const sohoLabel = makeLabel('soho/lasco', 'scene-label--accent', [0, -2.4, 0])
  soho.add(sohoLabel)
  scene.add(soho)

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, color: 0x5dff8f, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  halo.scale.setScalar(2.6)
  scene.add(halo)

  // Línea de visión de LASCO hacia el Sol
  const sightLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.35 }),
  )
  scene.add(sightLine)

  // Todo lo que se oculta al mirar "a través" de LASCO (los CSS2DObject no heredan la visibilidad del padre).
  const orbitalObjects = [orbitLine, earth, earthLabel, sunEarthLine, l1, l1Label, trail, soho, sohoLabel, halo, sightLine, sunLabel]

  // ── Imagen LASCO superpuesta ──
  // Un plano centrado en el Sol que siempre mira a la cámara, escalado para que el radio solar de la imagen
  // coincida con el del Sol 3D. Mezcla aditiva: el ocultador (negro) deja ver el Sol 3D detrás.
  const overlayMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat)
  overlayMesh.renderOrder = 10
  const overlay = new THREE.Group()
  overlay.add(overlayMesh)
  overlay.visible = false
  scene.add(overlay)

  const textureLoader = new THREE.TextureLoader()
  const textures = new Map() // url → textura (las últimas usadas)
  let lascoMeta = null
  let mix = 0.85

  function setLasco(meta) {
    if (!meta || meta.url === lascoMeta?.url) return
    lascoMeta = meta
    if (mode === 'lasco') tween = lascoPose()
    const apply = (tex) => {
      if (lascoMeta !== meta) return
      overlayMat.map = tex
      overlayMat.needsUpdate = true
      const k = SUN_R / meta.rsunPx // unidades de escena por píxel
      overlayMesh.scale.set(meta.width * k, meta.height * k, 1)
      // Desplazar el plano para que el centro del Sol de la imagen quede en el origen.
      overlayMesh.position.set((meta.width / 2 - meta.centerX) * k, (meta.centerY - meta.height / 2) * k, 0)
    }
    if (textures.has(meta.url)) return apply(textures.get(meta.url))
    textureLoader.load(meta.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      textures.set(meta.url, tex)
      // Conservar solo unas pocas texturas en memoria.
      for (const [url, t] of textures) {
        if (textures.size <= 6) break
        if (t !== overlayMat.map) {
          t.dispose()
          textures.delete(url)
        }
      }
      apply(tex)
    })
  }

  // ── Cámara ──
  // Modo 'orbit': OrbitControls + transiciones suaves entre vistas predefinidas.
  // Modo 'lasco': cámara en la línea Sol–SOHO, mirando al Sol con el norte solar arriba.
  let mode = 'orbit'
  let tween = null
  let lascoFov = LASCO_FOV
  const lookTarget = new THREE.Vector3()
  const keyPoints = { earth: new THREE.Vector3(), l1: new THREE.Vector3(), soho: new THREE.Vector3() }
  const Y = new THREE.Vector3(0, 1, 0)
  controls.addEventListener('start', () => (tween = null))

  // Distancia a la que el campo completo del coronógrafo cabe en pantalla. Para C2 coincide casi con la
  // posición de SOHO en la escena; para C3 (campo 5 veces mayor) la cámara retrocede sobre la misma línea.
  function lascoPose() {
    const rsun = lascoMeta?.rsunPx ?? 80.6
    const size = Math.min(lascoMeta?.width ?? 1024, lascoMeta?.height ?? 1024)
    const halfField = ((size / 2) * SUN_R) / rsun
    const dist = halfField / Math.tan(THREE.MathUtils.degToRad(LASCO_FOV / 2))
    return { pos: keyPoints.soho.clone().normalize().multiplyScalar(dist), target: new THREE.Vector3() }
  }

  function goTo(view) {
    if (view === 'lasco') {
      if (mode !== 'lasco') lookTarget.copy(controls.target)
      mode = 'lasco'
      controls.enabled = false
      lascoFov = LASCO_FOV
      tween = lascoPose()
      return
    }
    if (mode === 'lasco') {
      mode = 'orbit'
      controls.enabled = true
      controls.target.copy(lookTarget)
    }
    const dir = keyPoints.earth.clone().normalize()
    const side = new THREE.Vector3().crossVectors(Y, dir).normalize()
    let pos
    let target
    if (view === 'sun') {
      target = new THREE.Vector3()
      pos = dir.clone().multiplyScalar(17).addScaledVector(Y, 5).addScaledVector(side, 6)
    } else if (view === 'soho') {
      // De lado y algo por encima de L1: la Tierra queda a un lado y el Sol al fondo, al otro.
      target = keyPoints.l1.clone()
      pos = keyPoints.l1.clone().addScaledVector(side, 15).addScaledVector(Y, 7).addScaledVector(dir, 5)
    } else {
      target = keyPoints.earth.clone().multiplyScalar(0.55)
      pos = target.clone().addScaledVector(Y, 30).addScaledVector(side, -82).addScaledVector(dir, -8)
    }
    tween = { pos, target }
  }

  // En la vista LASCO, la rueda del mouse cambia el campo de visión (zoom) en lugar de mover la cámara.
  function onWheel(e) {
    if (mode !== 'lasco') return
    e.preventDefault()
    lascoFov = THREE.MathUtils.clamp(lascoFov * (1 + e.deltaY * 0.001), 8, 75)
  }
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

  function update(current, track) {
    const earthPos = toScene(current.earthPos).normalize().multiplyScalar((ORBIT_R * current.earthSunDistKm) / AU_KM)
    const axes = [toScene(current.frame.x), toScene(current.frame.y), toScene(current.frame.z)]
    // Posición en la escena de un punto dado en el sistema rotatorio, relativo a la Tierra (km).
    const near = (rel) =>
      earthPos
        .clone()
        .addScaledVector(axes[0], rel[0] * NEAR_SCALE)
        .addScaledVector(axes[1], rel[1] * NEAR_SCALE)
        .addScaledVector(axes[2], rel[2] * NEAR_SCALE)

    earth.position.copy(earthPos)
    sunEarthLine.geometry.setFromPoints([new THREE.Vector3(), earthPos])
    sunEarthLine.computeLineDistances()

    const l1Pos = near([-current.l1Dist, 0, 0])
    l1.position.copy(l1Pos)

    const sohoPos = near(current.relEarth)
    soho.position.copy(sohoPos)
    soho.lookAt(0, 0, 0)
    halo.position.copy(sohoPos)
    sightLine.geometry.setFromPoints([sohoPos, new THREE.Vector3()])

    trail.geometry.dispose()
    trail.geometry = new THREE.BufferGeometry().setFromPoints(track.map(near))

    // Si la Tierra avanzó en su órbita (otro instante seleccionado), girar la cámara alrededor del Sol
    // el mismo ángulo para conservar el encuadre relativo a la Tierra y a SOHO.
    if (mode === 'orbit' && keyPoints.earth.lengthSq() > 0) {
      const angle = Math.atan2(-earthPos.z, earthPos.x) - Math.atan2(-keyPoints.earth.z, keyPoints.earth.x)
      if (Math.abs(angle) > 1e-6) {
        const rot = new THREE.Matrix4().makeRotationY(angle)
        camera.position.applyMatrix4(rot)
        controls.target.applyMatrix4(rot)
        if (tween) {
          tween.pos.applyMatrix4(rot)
          tween.target.applyMatrix4(rot)
        }
      }
    }

    keyPoints.earth.copy(earthPos)
    keyPoints.l1.copy(l1Pos)
    keyPoints.soho.copy(sohoPos)
    if (mode === 'lasco') tween = lascoPose()
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    if (!w || !h) return
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    ascii.resize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  const timer = new THREE.Timer()
  let frame = requestAnimationFrame(function loop(timestamp) {
    frame = requestAnimationFrame(loop)
    timer.update(timestamp)
    const t = timer.getElapsed()
    sunUniforms.uTime.value = t
    sun.rotation.y = t * 0.02
    halo.material.opacity = 0.55 + Math.sin(t * 2.5) * 0.25

    let arrival = 0 // 0 → lejos de la pose LASCO, 1 → en posición
    if (mode === 'lasco') {
      const pose = tween ?? lascoPose()
      camera.position.lerp(pose.pos, 0.06)
      lookTarget.lerp(pose.target, 0.06)
      camera.up.lerp(north, 0.08).normalize()
      arrival = THREE.MathUtils.clamp(1 - camera.position.distanceTo(pose.pos) / 25, 0, 1)
      camera.fov += (lascoFov - camera.fov) * 0.08
      camera.updateProjectionMatrix()
      camera.lookAt(lookTarget)
    } else {
      camera.up.lerp(Y, 0.1).normalize()
      if (Math.abs(camera.fov - ORBIT_FOV) > 0.01) {
        camera.fov += (ORBIT_FOV - camera.fov) * 0.08
        camera.updateProjectionMatrix()
      }
      if (tween) {
        camera.position.lerp(tween.pos, 0.07)
        controls.target.lerp(tween.target, 0.07)
        if (camera.position.distanceTo(tween.pos) < 0.05) tween = null
      }
      controls.update()
      lookTarget.copy(controls.target)
    }

    // La imagen aparece al llegar a la posición de SOHO.
    const targetOpacity = mode === 'lasco' && overlayMat.map ? mix * arrival : 0
    overlayMat.opacity += (targetOpacity - overlayMat.opacity) * 0.1
    overlay.visible = overlayMat.opacity > 0.005
    overlay.quaternion.copy(camera.quaternion)

    const hideOrbital = mode === 'lasco' && arrival > 0.4
    for (const obj of orbitalObjects) obj.visible = !hideOrbital
    stars.material.opacity = 0.75 * (1 - overlayMat.opacity * 0.85)
    glow.material.opacity = (0.9 + Math.sin(t * 0.8) * 0.06) * (1 - overlayMat.opacity * 0.6)

    renderer.render(scene, camera)
    ascii.render(renderer.domElement) // justo después de renderizar, mientras el buffer WebGL sigue disponible
    labelRenderer.render(scene, camera)
  })

  return {
    update,
    goTo,
    setLasco,
    setMix(value) {
      mix = value
    },
    /** 'off' | 'ascii' | 'ascii-color' */
    setFilter(mode) {
      ascii.setMode(mode)
      renderer.domElement.style.opacity = mode === 'off' ? '' : '0'
    },
    dispose() {
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('wheel', onWheel)
      scene.traverse((obj) => {
        obj.geometry?.dispose()
        obj.material?.dispose?.()
      })
      glowTex.dispose()
      for (const tex of textures.values()) tex.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      ascii.dispose()
      labelRenderer.domElement.remove()
    },
  }
}

/**
 * Vista 3D del Sol con la posición de SOHO.
 * `current`: instante seleccionado (describeSample). `track`: posiciones de SOHO relativas a la Tierra
 * en el sistema rotatorio, para dibujar la órbita halo. `view`: 'overview' | 'sun' | 'soho' | 'lasco'.
 * `lascoImage`: metadatos de la imagen LASCO a superponer en la vista 'lasco'; `mix`: su opacidad (0–1).
 * `filter`: 'off' | 'ascii' | 'ascii-color' — dibuja la escena con caracteres de texto.
 */
export default function SunScene({ current, track, view, viewNonce, lascoImage, mix, filter = 'off' }) {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const placedRef = useRef(false)

  useEffect(() => {
    sceneRef.current = buildScene(containerRef.current)
    return () => {
      sceneRef.current.dispose()
      sceneRef.current = null
      placedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!current || !sceneRef.current) return
    sceneRef.current.update(current, track)
    // La primera vez que hay datos, encuadrar la cámara.
    if (!placedRef.current) {
      placedRef.current = true
      sceneRef.current.goTo(view)
    }
  }, [current, track]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (placedRef.current) sceneRef.current?.goTo(view)
  }, [view, viewNonce])

  useEffect(() => {
    sceneRef.current?.setLasco(lascoImage)
  }, [lascoImage])

  useEffect(() => {
    sceneRef.current?.setMix(mix)
  }, [mix])

  useEffect(() => {
    sceneRef.current?.setFilter(filter)
  }, [filter])

  return <div className="scene" ref={containerRef} />
}
