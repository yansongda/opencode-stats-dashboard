#!/usr/bin/env node
"use strict"

const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")
const SIDECAR_DIR = path.join(ROOT, "sidecar")
const CONFIG_PATH = path.join(ROOT, ".sidecar-config.json")

const PLATFORM_MAP = {
  darwin: "apple-darwin",
  linux: "unknown-linux-gnu",
  win32: "pc-windows-msvc",
}

const ARCH_MAP = {
  x64: "x86_64",
  arm64: "aarch64",
}

function detectBinary() {
  const platform = process.platform
  const arch = process.arch

  const rustPlatform = PLATFORM_MAP[platform]
  const rustArch = ARCH_MAP[arch]

  if (!rustPlatform || !rustArch) {
    console.warn(
      `[postinstall] Unsupported platform: ${platform}/${arch}. ` +
        "You may need to build the sidecar manually.",
    )
    return null
  }

  const binaryName = platform === "win32" ? "sidecar-api.exe" : "sidecar-api"
  const binaryPath = path.join(SIDECAR_DIR, "target", "debug", binaryName)

  return {
    platform,
    arch,
    rustTarget: `${rustArch}-${rustPlatform}`,
    binaryPath: path.relative(ROOT, binaryPath),
    exists: fs.existsSync(binaryPath),
  }
}

function writeConfig(info) {
  const config = {
    sidecar: {
      target: info ? info.rustTarget : null,
      binary: info ? info.binaryPath : null,
      built: info ? info.exists : false,
    },
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n")
  console.log(`[postinstall] Wrote sidecar config to ${path.relative(ROOT, CONFIG_PATH)}`)
}

// --- main ---
const info = detectBinary()

if (info) {
  console.log(`[postinstall] Detected: ${info.platform}/${info.arch} (${info.rustTarget})`)
  if (info.exists) {
    console.log(`[postinstall] Sidecar binary found at ${info.binaryPath}`)
  } else {
    console.warn(
      `[postinstall] Sidecar binary not yet built. Run "npm run build" to compile.`,
    )
  }
}

writeConfig(info)
