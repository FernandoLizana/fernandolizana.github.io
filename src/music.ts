/**
 * Pieza original para el observatorio: acordes lentos y un pulso grave.
 * No usa la melodía del video; solo comparte el clima de un viaje espacial.
 */
const CHORDS = [
  [110, 164.81, 220],
  [98, 146.83, 196],
  [87.31, 130.81, 174.61],
  [130.81, 164.81, 196],
]

let shared: AudioContext | null = null
let stopEngine: (() => void) | null = null

function audioContext(): AudioContext {
  shared ??= new AudioContext()
  return shared
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTakeoff()
})

export function stopTakeoff() {
  stopEngine?.()
  stopEngine = null
}

/** Motor original: un ruido grave que sube de tono mientras dura el acercamiento. */
export function playTakeoff(durationMs: number) {
  try {
    const context = audioContext()
    void context.resume()
    stopTakeoff()
    const seconds = Math.min(3.2, Math.max(0.7, durationMs / 1000))
    stopEngine = startTakeoff(context, seconds)
  } catch {
    stopEngine = null
  }
}

export function bindMusic(button: HTMLButtonElement) {
  let playing = false
  let stop = () => {}

  button.addEventListener('click', async () => {
    const context = audioContext()
    if (context.state === 'suspended') await context.resume()
    if (playing) {
      stop()
      playing = false
      button.setAttribute('aria-pressed', 'false')
      button.textContent = 'Música'
      return
    }
    stop = playScore(context)
    playing = true
    button.setAttribute('aria-pressed', 'true')
    button.textContent = 'Silencio'
  })

  document.addEventListener('visibilitychange', () => {
    const context = shared
    if (!context || !playing) return
    if (document.hidden) void context.suspend()
    else void context.resume()
  })
}

function engineNoise(context: AudioContext): AudioBuffer {
  const length = context.sampleRate
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let brown = 0
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.02 * white) / 1.02
    data[index] = brown * 3.2
  }
  return buffer
}

function startTakeoff(context: AudioContext, seconds: number): () => void {
  const now = context.currentTime
  const master = context.createGain()
  master.gain.setValueAtTime(0.0001, now)
  master.gain.exponentialRampToValueAtTime(0.2, now + 0.16)
  master.gain.setValueAtTime(0.2, now + Math.max(0.22, seconds - 0.4))
  master.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
  master.connect(context.destination)

  const roar = context.createBiquadFilter()
  roar.type = 'lowpass'
  roar.frequency.setValueAtTime(120, now)
  roar.frequency.exponentialRampToValueAtTime(1500, now + seconds * 0.75)
  roar.Q.value = 0.65
  roar.connect(master)

  const noise = context.createBufferSource()
  noise.buffer = engineNoise(context)
  noise.loop = true
  noise.connect(roar)
  noise.start(now)
  noise.stop(now + seconds + 0.05)

  const whoosh = context.createBufferSource()
  whoosh.buffer = noise.buffer
  whoosh.loop = true
  const band = context.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.7
  band.frequency.setValueAtTime(220, now)
  band.frequency.exponentialRampToValueAtTime(1900, now + seconds * 0.55)
  const whooshGain = context.createGain()
  whooshGain.gain.setValueAtTime(0.0001, now)
  whooshGain.gain.exponentialRampToValueAtTime(0.35, now + seconds * 0.22)
  whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds * 0.72)
  whoosh.connect(band)
  band.connect(whooshGain)
  whooshGain.connect(master)
  whoosh.start(now)
  whoosh.stop(now + seconds + 0.05)

  const rumble = context.createOscillator()
  rumble.type = 'triangle'
  rumble.frequency.setValueAtTime(40, now)
  rumble.frequency.exponentialRampToValueAtTime(92, now + seconds * 0.8)
  const rumbleGain = context.createGain()
  rumbleGain.gain.value = 0.16
  rumble.connect(rumbleGain)
  rumbleGain.connect(roar)
  rumble.start(now)
  rumble.stop(now + seconds + 0.05)

  const lift = context.createOscillator()
  lift.type = 'sine'
  lift.frequency.setValueAtTime(98, now)
  lift.frequency.exponentialRampToValueAtTime(294, now + seconds * 0.85)
  const liftGain = context.createGain()
  liftGain.gain.setValueAtTime(0.0001, now)
  liftGain.gain.exponentialRampToValueAtTime(0.07, now + seconds * 0.3)
  liftGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
  lift.connect(liftGain)
  liftGain.connect(master)
  lift.start(now)
  lift.stop(now + seconds + 0.05)

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    const at = context.currentTime
    master.gain.cancelScheduledValues(at)
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), at)
    master.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
    window.setTimeout(() => {
      try { noise.stop() } catch { /* el motor ya terminó */ }
      try { whoosh.stop() } catch { /* el motor ya terminó */ }
      try { rumble.stop() } catch { /* el motor ya terminó */ }
      try { lift.stop() } catch { /* el motor ya terminó */ }
      master.disconnect()
    }, 280)
  }
  window.setTimeout(stop, seconds * 1000 + 40)
  return stop
}

function playScore(context: AudioContext): () => void {
  const now = context.currentTime
  const master = context.createGain()
  master.connect(context.destination)
  master.gain.setValueAtTime(0.0001, now)
  master.gain.exponentialRampToValueAtTime(0.42, now + 0.28)

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(2200, now)
  filter.Q.value = 0.5
  filter.connect(master)

  const voices = CHORDS[0].flatMap((frequency, index) => {
    return [1, 2].map((octave) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = octave === 1 ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency * octave, now)
      oscillator.detune.setValueAtTime((index - 1) * 7, now)
      gain.gain.setValueAtTime(0.0001, now)
      oscillator.connect(gain)
      gain.connect(filter)
      oscillator.start(now)
      return { oscillator, gain, octave }
    })
  })

  let step = 0
  const change = () => {
    const chord = CHORDS[step % CHORDS.length]
    const at = context.currentTime
    chord.forEach((frequency, index) => {
      for (const octave of [1, 2]) {
        const voice = voices[index * 2 + (octave - 1)]
        voice.oscillator.frequency.setTargetAtTime(frequency * octave, at, 0.35)
        if (step > 0) continue
        const level = octave === 1 ? 0.14 : 0.08
        voice.gain.gain.setValueAtTime(0.0001, at)
        voice.gain.gain.exponentialRampToValueAtTime(level, at + 0.22)
      }
    })
    step += 1
  }
  change()
  const timer = window.setInterval(change, 6400)

  return () => {
    window.clearInterval(timer)
    const at = context.currentTime
    master.gain.cancelScheduledValues(at)
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), at)
    master.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
    window.setTimeout(() => {
      for (const voice of voices) voice.oscillator.stop()
      master.disconnect()
    }, 400)
  }
}
