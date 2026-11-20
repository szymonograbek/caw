import * as Fs from "node:fs/promises";
import { Context, Effect, Layer, Option, Schema } from "effect";

export class HostFileError extends Schema.TaggedError<
  HostFileError,
  { readonly brand: unique symbol }
>()("HostFileError", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

const attempt = <A>(operation: string, path: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new HostFileError({ operation, path, cause }),
  });

const isMissing = (error: HostFileError) =>
  Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error.cause);

/**
 * The few file operations the daemon performs on the host: its state folder,
 * Workspaces and saved attachments.
 */
export class HostFiles extends Context.Service<
  HostFiles,
  {
    /** `None` when the file does not exist. */
    readonly readText: (path: string) => Effect.Effect<Option.Option<string>, HostFileError>;
    readonly writeText: (path: string, text: string) => Effect.Effect<void, HostFileError>;
    readonly writeBytes: (path: string, bytes: Uint8Array) => Effect.Effect<void, HostFileError>;
    /** Sets the file's permission bits, e.g. `0o600` for secrets or `0o755` for scripts. */
    readonly setMode: (path: string, mode: number) => Effect.Effect<void, HostFileError>;
    /** Creates the directory and its parents; succeeds when it exists. */
    readonly ensureDirectory: (path: string) => Effect.Effect<void, HostFileError>;
    /** Removes a file or directory tree; succeeds when it is already gone. */
    readonly remove: (path: string) => Effect.Effect<void, HostFileError>;
  }
>()("@gloaming/core/HostFiles") {
  static readonly layer = Layer.succeed(HostFiles, {
    readText: (path) =>
      attempt("read", path, () => Fs.readFile(path, "utf8")).pipe(
        Effect.asSome,
        Effect.catchIf(isMissing, () => Effect.succeedNone),
      ),
    writeText: (path, text) => attempt("write", path, () => Fs.writeFile(path, text)),
    writeBytes: (path, bytes) => attempt("write", path, () => Fs.writeFile(path, bytes)),
    setMode: (path, mode) => attempt("chmod", path, () => Fs.chmod(path, mode)),
    ensureDirectory: (path) =>
      attempt("mkdir", path, () => Fs.mkdir(path, { recursive: true }).then(() => undefined)),
    remove: (path) => attempt("remove", path, () => Fs.rm(path, { recursive: true, force: true })),
  });
}
