/**
 * The vendored `simple` FTS5 tokenizer (jieba segmentation plus pinyin).
 *
 * The binaries and the jieba dictionary ship inside the package under
 * `native/simple/`. Every file is checked against the SHA-256 pinned here
 * before SQLite loads it: a missing or tampered file leaves the store
 * read-only instead of loading unknown native code.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Upstream release vendored under `native/simple/`. */
export const SIMPLE_VERSION = '0.7.1'

/** Pinned SHA-256 of every vendored file, relative to `native/simple/`. */
export const PINNED_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'darwin-arm64/libsimple.dylib': 'b5986159151ad95ccbf056ef8af22c7ae35112dbd081a96c047bb1720c66c9dc',
  'darwin-x64/libsimple.dylib': 'cb0b8cb102ab9680d2f5c0adac7dec15827904914250894623b2b9b14918d15d',
  'dict/README.md': '8bcc7c2ed7dff082d9a99c09de0bfd72249bf3b5c4298a3af328da40cbd8cfd1',
  'dict/hmm_model.utf8': 'f17790586ac86dd048c8adffed052c4bd2b28ed0682972c1275e59040c0589a7',
  'dict/idf.utf8': 'dbd1e03d72b2263cc8d84a4304ed77677eed9e7deaf43a1a5133bbba9733b535',
  'dict/jieba.dict.utf8': '3043b77068e09c9904f27cad82f12b6ebe9dbdb5aeff3b25e45ab7f9c1122b55',
  'dict/pos_dict/char_state_tab.utf8': '28b7be1dd7369766a51445af4d42e9a2ba4bf374c13be5bc1ca7721e27271dbb',
  'dict/pos_dict/prob_emit.utf8': 'c33c4cb7edf3b3a5947df7209b6e9f267eae1f21335d9e2bd2521ea07105457a',
  'dict/pos_dict/prob_start.utf8': '13623ea0e9300bdb597cb2da28770b7b385d6c0098d66e516083fb01b6bd5d96',
  'dict/pos_dict/prob_trans.utf8': 'f22363e2307408293d180c6f9f6b5cb75879d52f722f7764fa2d3d0ae2400236',
  'dict/stop_words.utf8': 'b788b8a939d2e2fe079abd579ea98f12f9fb84370bfd0dddd81bb9381f7ab42c',
  'dict/user.dict.utf8': '495bbf49270408a1234690e1e6a97328f30a482a7a72aa769e8a12e8714b0c62',
})

/** A verified tokenizer: the extension to load and the dictionary directory to hand to `jieba_dict`. */
export interface Tokenizer {
  readonly library: string
  readonly dictDir: string
}

export type TokenizerCheck = { readonly ok: true; readonly tokenizer: Tokenizer } | { readonly ok: false; readonly reason: string }

/** The package's `native/simple/` directory (the package root is `lib/..` at runtime and `src/..` under tests). */
export function defaultNativeRoot(): string {
  return fileURLToPath(new URL('../native/simple/', import.meta.url))
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * Verify the vendored tokenizer for this machine.
 * @param root - the `native/simple/` directory.
 * @param platform - defaults to the running process's platform.
 * @param arch - defaults to the running process's architecture.
 */
export function verifyTokenizer(root: string = defaultNativeRoot(), platform: string = process.platform, arch: string = process.arch): TokenizerCheck {
  if (platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) {
    return { ok: false, reason: `the search tokenizer ships for macOS only (this is ${platform}-${arch})` }
  }
  const binary = `darwin-${arch}/libsimple.dylib`
  const files = [binary, ...Object.keys(PINNED_SHA256).filter((file) => file.startsWith('dict/'))]
  for (const file of files) {
    let actual: string
    try {
      actual = sha256(join(root, file))
    } catch {
      return { ok: false, reason: `the search tokenizer file native/simple/${file} is missing or unreadable; reinstall the plugin` }
    }
    if (actual !== PINNED_SHA256[file]) {
      return { ok: false, reason: `the search tokenizer file native/simple/${file} failed its integrity check; reinstall the plugin` }
    }
  }
  return { ok: true, tokenizer: { library: join(root, binary), dictDir: join(root, 'dict') } }
}
