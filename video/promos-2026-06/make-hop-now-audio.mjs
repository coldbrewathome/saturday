#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(here, "audio");
const videoIn = path.join(here, "hop-now.mp4");
const videoOut = path.join(here, "hop-now-with-audio.mp4");
const voicePath = path.join(audioDir, "hop-now-voice-marin.mp3");
const musicPath = path.join(audioDir, "hop-now-music-bed.wav");
const scriptPath = path.join(audioDir, "hop-now-voiceover.txt");
const durationSeconds = 21;

const voiceover = [
  "FamHop Hop Now is for that exact moment: everyone is ready, but nobody has a plan.",
  "Kids are bored?",
  "Open FamHop and tap Hop me now.",
  "It finds things that are open, close by, and starting soon.",
  "Pick one, get directions, and go.",
  "FamHop. Last-minute family plans, solved.",
].join(" ");

const voiceInstructions = [
  "Warm, upbeat parent-to-parent delivery.",
  "Sound like a helpful friend with energy, not a hard-sell announcer.",
  "Keep the pace brisk, clear, and optimistic, with light emphasis on 'Hop me now' and 'go'.",
].join(" ");

fs.mkdirSync(audioDir, { recursive: true });
fs.writeFileSync(scriptPath, `${voiceover}\n`, "utf8");

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(sample) {
  return Math.max(-1, Math.min(1, sample));
}

function writeWav(file, samples, sampleRate) {
  const bytesPerSample = 2;
  const channels = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(clamp(samples[i]) * 32767), 44 + i * bytesPerSample);
  }
  fs.writeFileSync(file, buffer);
}

function synthMusic(file) {
  const sampleRate = 48000;
  const totalSamples = Math.ceil(durationSeconds * sampleRate);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  const bpm = 116;
  const beat = 60 / bpm;
  const chords = [
    [60, 64, 67],
    [59, 62, 67],
    [57, 60, 64],
    [53, 57, 60],
  ];

  function addStereo(sampleIndex, value, pan) {
    if (sampleIndex < 0 || sampleIndex >= totalSamples) return;
    const l = Math.cos((pan + 1) * Math.PI / 4);
    const r = Math.sin((pan + 1) * Math.PI / 4);
    left[sampleIndex] += value * l;
    right[sampleIndex] += value * r;
  }

  function addTone(start, length, frequency, amplitude, pan = 0, kind = "pluck") {
    const startSample = Math.max(0, Math.floor(start * sampleRate));
    const endSample = Math.min(totalSamples, Math.floor((start + length) * sampleRate));
    for (let i = startSample; i < endSample; i += 1) {
      const t = (i - startSample) / sampleRate;
      let env;
      if (kind === "pad") {
        const attack = Math.min(1, t / 0.18);
        const release = Math.min(1, (endSample - i) / (sampleRate * 0.35));
        env = attack * release * 0.72;
      } else if (kind === "bass") {
        env = Math.min(1, t / 0.012) * Math.exp(-3.4 * t);
      } else {
        env = Math.min(1, t / 0.01) * Math.exp(-5.8 * t);
      }
      const tone =
        Math.sin(2 * Math.PI * frequency * t) * 0.82 +
        Math.sin(2 * Math.PI * frequency * 2 * t) * 0.12 +
        Math.sin(2 * Math.PI * frequency * 3 * t) * 0.06;
      addStereo(i, tone * env * amplitude, pan);
    }
  }

  function addKick(start) {
    const startSample = Math.floor(start * sampleRate);
    const length = Math.floor(0.28 * sampleRate);
    for (let i = 0; i < length; i += 1) {
      const idx = startSample + i;
      const t = i / sampleRate;
      const frequency = 76 - 34 * Math.min(1, t / 0.12);
      const env = Math.exp(-10 * t);
      addStereo(idx, Math.sin(2 * Math.PI * frequency * t) * env * 0.17, 0);
    }
  }

  function noiseAt(index) {
    const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  function addNoiseHit(start, length, amplitude, pan = 0) {
    const startSample = Math.floor(start * sampleRate);
    const count = Math.floor(length * sampleRate);
    for (let i = 0; i < count; i += 1) {
      const idx = startSample + i;
      const t = i / sampleRate;
      const env = Math.exp(-32 * t);
      const shaped = (noiseAt(idx) - noiseAt(idx - 1)) * 0.5;
      addStereo(idx, shaped * env * amplitude, pan);
    }
  }

  for (let t = 0; t < durationSeconds + beat; t += beat * 2) {
    const chord = chords[Math.floor(t / (beat * 2)) % chords.length];
    chord.forEach((midi, index) => {
      addTone(t, beat * 2.15, midiToFrequency(midi - 12), 0.018, [-0.34, 0.18, 0.44][index], "pad");
    });
    for (let step = 0; step < 4; step += 1) {
      const note = chord[[0, 1, 2, 1][step]] + (step === 2 ? 12 : 0);
      addTone(t + step * beat * 0.5 + 0.04, 0.32, midiToFrequency(note), 0.058, step % 2 ? 0.26 : -0.22);
    }
    addTone(t, beat * 0.9, midiToFrequency(chord[0] - 24), 0.055, -0.08, "bass");
  }

  for (let t = 0; t < durationSeconds; t += beat) {
    const beatNumber = Math.round(t / beat);
    if (beatNumber % 2 === 0) addKick(t);
    if (t > 1.8) addNoiseHit(t + beat * 0.5, 0.055, 0.018, beatNumber % 4 === 0 ? -0.25 : 0.25);
    if (beatNumber % 4 === 1 && t > 1.5) addNoiseHit(t, 0.12, 0.034, 0.08);
  }

  [0.18, 0.42, 18.8, 19.06].forEach((t, index) => {
    addTone(t, 0.55, midiToFrequency(index < 2 ? 84 : 88), 0.04, index % 2 ? 0.36 : -0.36);
  });

  let peak = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, t / 0.35);
    const fadeOut = Math.min(1, (durationSeconds - t) / 1.1);
    const gain = Math.max(0, Math.min(fadeIn, fadeOut));
    left[i] *= gain;
    right[i] *= gain;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }

  const normalize = peak > 0 ? Math.min(1, 0.82 / peak) : 1;
  const interleaved = new Float32Array(totalSamples * 2);
  for (let i = 0; i < totalSamples; i += 1) {
    interleaved[i * 2] = left[i] * normalize;
    interleaved[i * 2 + 1] = right[i] * normalize;
  }
  writeWav(file, interleaved, sampleRate);
}

async function createVoice() {
  if (!process.argv.includes("--refresh-voice") && fs.existsSync(voicePath) && fs.statSync(voicePath).size > 1024) {
    return;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: voiceover,
      instructions: voiceInstructions,
    }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Speech API request failed: ${response.status} ${message}`);
  }
  fs.writeFileSync(voicePath, Buffer.from(await response.arrayBuffer()));
}

function mixVideo() {
  const filter = [
    `[1:a]atrim=0:${durationSeconds},asetpts=N/SR/TB,volume=0.58,afade=t=in:st=0:d=0.25,afade=t=out:st=${durationSeconds - 1.1}:d=1.1[music]`,
    `[2:a]adelay=520|520,apad,atrim=0:${durationSeconds},asetpts=N/SR/TB,volume=1.30,acompressor=threshold=-10dB:ratio=1.8:attack=5:release=90[voice0]`,
    "[voice0]asplit=2[voiceSide][voiceMix]",
    "[music][voiceSide]sidechaincompress=threshold=0.035:ratio=8:attack=24:release=280[ducked]",
    "[ducked][voiceMix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,volume=1.12,alimiter=limit=0.92,aresample=48000[a]",
  ].join(";");

  execFileSync("ffmpeg", [
    "-y",
    "-i", videoIn,
    "-i", musicPath,
    "-i", voicePath,
    "-filter_complex", filter,
    "-map", "0:v:0",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-movflags", "+faststart",
    videoOut,
  ], { stdio: "inherit" });
}

synthMusic(musicPath);
await createVoice();
mixVideo();

console.log(`wrote ${videoOut}`);
