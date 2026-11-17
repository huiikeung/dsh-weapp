# native-atomic EFFECTS NOTES

Compiled 2026-11-05 from the HarmonyOS SDK headers shipped with DevEco Studio on this Mac
(/Applications/DevEco-Studio.app/Contents/sdk/default/) and from project sources under
/Users/0the/Downloads/dsh-weapp/harmonyos and the miniprogram reference under
/Users/0the/Downloads/dsh-weapp/miniprogram.
No source code was changed; this document is the only artifact.

## 0. Verified module layout
- native-atomic/oh_modules contains ONLY @ohos/hypium@1.0.19 (unit-test framework) plus .ohpm
  metadata. There are no user application modules and no third-party effect libraries.
- native-atomic/oh-package.json5: devDependencies @ohos/hypium 1.0.19; dependencies:
  nativecore -> ../../native-core.
- native-core/Index.ets re-exports OceanBackground, ParticleBackground, ThemeManager,
  Logger, PreferencesStore, AppState, GatewayClient, SessionStore, ScheduleStore,
  PluginStore, EventProjector, CredentialStore, plus protocol/crypto helpers.
- native-atomic/entry/oh_modules/nativecore is a symlink to ../../../native-core, so the
  library is consumed live from source.
- build-profile.json5: stageMode API type, compatible/target SDK 26.0.0, debug+release
  buildOptionSet; modules nativecore (srcPath ../native-core) and entry.
- native-atomic/entry/src/main/ets/pages/HomePage.ets already mounts OceanBackground()
  inside its root Stack (line ~1208) for the dark theme, and a light linearGradient
  otherwise. ParticleBackground is exported but NOT mounted on any page yet.
- The whole harmonyos tree currently uses no blur/backgroundBlurStyle/mask/blendMode at all;
  the only effect modifiers in use are .clip(true) on 8 list items in settings pages.

## 1. Particle effect: the native ArkUI Particle component

### 1.1 SDK contract
- Declaration: sdk/default/openharmony/ets/component/particle.d.ts
  (build copy under ets/build-tools/ets-loader/declarations/particle.d.ts).
- Kit: @kit.ArkUI. The component is Particle, NOT "ParticleEmitter".
- Usage: Particle({ particles: [ ...ParticleOptions... ] })
- since: 10 (component and options); 11 for atomicservice; 12 for DistributionType;
  18 for the Particles generic object form and SpawnDistribution.
- syscap: SystemCapability.ArkUI.ArkUI.Full. Stage model only; cross-platform;
  usable from an atomic service.

### 1.2 Enumerations (all read out of particle.d.ts)
- ParticleType.POINT = "point"  (default, point-like particle)
- ParticleType.IMAGE = "image"  (image-like particle)
- ParticleEmitterShape.RECTANGLE = "rectangle"  (default)
  ParticleEmitterShape.CIRCLE = "circle"
  ParticleEmitterShape.ELLIPSE = "ellipse"
  ParticleEmitterShape.ANNULUS = "annulus"
  ParticleEmitterShape.STAR = "star"
- ParticleUpdater.NONE = "none"      (value stays constant)
  ParticleUpdater.RANDOM = "random"  (value picked randomly inside the range)
  ParticleUpdater.CURVE = "curve"    (value follows a value/time curve)
- DistributionType.UNIFORM = 0, DistributionType.GAUSSIAN = 1 (since API 12)

### 1.3 ParticleOptions shape
- emitter: EmitterOptions<PARTICLE>          (required)
- color?: ParticleColorPropertyOptions<COLOR_UPDATER>
- opacity?: ParticlePropertyOptions<number, OPACITY_UPDATER>
- scale?: ParticlePropertyOptions<number, SCALE_UPDATER>
- velocity?: VelocityOptions
- acceleration?: AccelerationOptions<ACC_SPEED_UPDATER, ACC_ANGLE_UPDATER>
- spin?: SpinOptions

### 1.4 Sub-type contracts
- VelocityOptions { speed: ParticleTuple<number, number>; angle: ParticleTuple<number, number> }
  speed = time rate of travel, angle = degrees clockwise around the element centre.
- AccelerationOptions { speed?: ParticlePropertyOptions<number, ...>;
  angle?: ParticlePropertyOptions<number, ...> }   (both default to range [0, 0])
- EmitterOptions carries position ({ x, y }, accepts "50%" / 110), shape,
  size ({ width, height }), density ({ value }), distribution ({ type }) and the
  emission count / lifetime / lifeTimeRange knobs.
- ParticlePropertyOptions<T> = { type: value | updater; updater: ParticleUpdater }
- SpinOptions extends ParticlePropertyOptions<number> and adds direction (1 = clockwise,
  -1 = counter-clockwise).

### 1.5 Hard limits found in the SDK
- The native Particle component has NO fragment-shader hook, NO per-particle draw
  callback, and NO canvas-mask input. It is a declarative emitter driven by ranges
  plus updaters only. Anything needing real GLSL must go through XComponent/EGL or
  a WebGL canvas.
- Image particles cannot be recolored (color is ignored for ParticleType.IMAGE).
- lifetime -1 means infinite particles; the SDK explicitly warns about the performance
  cost.
- DistributionType requires API 12; the project targets API 26 (compatibleSdkVersion),
  so everything above is available.

### 1.6 Concrete buildable particle recipe (matches native-core/ParticleBackground.ets)

  Particle({
    particles: [{
      type: ParticleType.POINT,
      emitter: {
        position: { x: "50%", y: "110%" },        // emitter sits below the fold
        shape: ParticleEmitterShape.RECTANGLE,
        size: { width: "100%", height: "10%" },
        density: { value: 36 },
        distribution: { type: DistributionType.UNIFORM }
      },
      color: { range: { value: ["rgba(150,200,255,0.55)", "rgba(150,200,255,0.55)"] },
               updater: { type: ParticleUpdater.NONE } },
      opacity: { range: { value: [0.15, 0.65] }, updater: { type: ParticleUpdater.NONE } },
      scale: { range: { value: [0.6, 1.8] }, updater: { type: ParticleUpdater.NONE } },
      velocity: { speed: { value: [6, 22] }, angle: { value: [-90, -90] } },
      acceleration: { speed: { value: [1, 4] }, angle: { value: [-90, -90] } },
      spin: { value: { value: [2, 10] }, direction: 1 }
    }]
  })

  Notes on shape: ParticlePropertyOptions nests the range under "range" and the
  updater under "updater"; velocity/acceleration nest the tuple under "value".
  native-core/src/main/ets/components/ParticleBackground.ets is the in-repo reference
  implementation and already compiles against this SDK.