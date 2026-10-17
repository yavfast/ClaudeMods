# Rules: error handling in hook modules

How hook work that may not throw records its failures. Origin: code audit PL_AUD2_CTX (CF2-57; recurring CF-32).

## ERR-01 — Let every swallowed failure of background work leave one debug line with a label and the error, never content (should)  {#ERR-01}

**Applies to:** `mods/*/hooks/**` — `.catch(...)` and `catch {}` in background or deferred work (chains, `$.clock.after`, `void` promises, post-commit writes).

A failure the mod chooses not to surface still goes to `$.ui.log(text, { to: 'debug' })` (through a port such as `debug` or a top-level helper in `register.ts`): a short step label plus `errorText(err)`; never row text, reports or file contents. A bare `.catch(() => undefined)` is kept only where a comment names why the failure is expected.

### Why
Silent catches grew from ~55 (audit 20261011, CF-32) to ~145 (audit 20261017, PAT-8/STD-4), and a failed background write is invisible in `~/.claude/debug/<session>.txt` during live runs.

### Examples

**Correct:**
```ts
// mods/context-editor/hooks/capabilities.ts:379
await io.remove(paths).catch(err => io.debug?.(modText(`probe cleanup failed: ${errorText(err)}`)))
```

**Incorrect:**
```ts
void io.updateTags(dir)(change).catch(() => undefined)   // no trace of a failed registry write
```

**Provenance:** [PL_AUD2_CTX](../audit/context-editor_20261017_101904.plan.md) CF2-57 (audit 20261017_101904); [PL_AUD_CTX](../audit/context-editor_20261011_182951.plan.md) CF-32; security constraint «logs without content» (X9).
