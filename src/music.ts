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

export function bindMusic(button: HTMLButtonElement) {
  let context: AudioContext | null = null
  let playing = false
  let stop = () => {}

  button.addEventListener('click', async () => {
    context ??= new AudioContext()
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
    if (!context || !playing) return
    if (document.hidden) void context.suspend()
    else void context.resume()
  })
}

function playScore(context: AudioContext): () => void {
  const master = context.createGain()
  master.gain.value = 0.0001
  master.connect(context.destination)
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 720
  filter.Q.value = 0.6
  filter.connect(master)
  const now = context.currentTime
  master.gain.exponentialRampToValueAtTime(0.18, now + 1.6)

  const voices = CHORDS[0].map(() => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    gain.gain.value = 0.0001
    oscillator.connect(gain)
    gain.connect(filter)
    oscillator.start()
    return { oscillator, gain }
  })
  const pulse = context.createOscillator()
  const pulseGain = context.createGain()
  pulse.type = 'triangle'
  pulse.frequency.value = 55
  pulseGain.gain.value = 0.0001
  pulse.connect(pulseGain)
  pulseGain.connect(filter)
  pulse.start()

  let step = 0
  const change = () => {
    const chord = CHORDS[step % CHORDS.length]
    const at = context.currentTime
    chord.forEach((frequency, index) => {
      const voice = voices[index]
      voice.oscillator.frequency.setTargetAtTime(frequency, at, 0.8)
      voice.gain.gain.cancelScheduledValues(at)
      voice.gain.gain.setTargetAtTime(0.22, at, 1.1)
    })
    pulseGain.gain.cancelScheduledValues(at)
    pulseGain.gain.setTargetAtTime(step % 2 === 0 ? 0.05 : 0.02, at, 0.4)
    step += 1
  }
  change()
  const timer = window.setInterval(change, 6400)

  return () => {
    window.clearInterval(timer)
    const at = context.currentTime
    master.gain.cancelScheduledValues(at)
    master.gain.setTargetAtTime(0.0001, at, 0.2)
    window.setTimeout(() => {
      for (const voice of voices) voice.oscillator.stop()
      pulse.stop()
      master.disconnect()
    }, 900)
  }
}
