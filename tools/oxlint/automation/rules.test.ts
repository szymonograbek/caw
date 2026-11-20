import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import noTypeAssertion from "./rules/no-type-assertion.ts";
import noBannedTypeAssertions from "./rules/no-banned-type-assertions.ts";
import noOptionalFunctionParameters from "./rules/no-optional-function-parameters.ts";
import noAmbientNondeterminism from "./rules/no-ambient-nondeterminism.ts";
import noDirectBrowserStorage from "./rules/no-direct-browser-storage.ts";
import noDirectFetch from "./rules/no-direct-fetch.ts";
import noDisableValidation from "./rules/no-disable-validation.ts";
import noGlobalJson from "./rules/no-global-json.ts";
import noInOperator from "./rules/no-in-operator.ts";
import noTypeofObject from "./rules/no-typeof-object.ts";
import noTryCatch from "./rules/no-try-catch.ts";
import noSilentErrorSwallow from "./rules/no-silent-error-swallow.ts";
import noSwitch from "./rules/no-switch.ts";
import noServiceOption from "./rules/no-service-option.ts";
import noStaticEffectServiceForwarders from "./rules/no-static-effect-service-forwarders.ts";
import requireContextServiceInServices from "./rules/require-context-service-in-services.ts";
import noNestedLayerProvide from "./rules/no-nested-layer-provide.ts";
import noCascadingLayerProvide from "./rules/no-cascading-layer-provide.ts";
import noNestedEffectArrayMethods from "./rules/no-nested-effect-array-methods.ts";
import noShadowedStandardArrayStatic from "./rules/no-shadowed-standard-array-static.ts";
import preferOptionFromNullable from "./rules/prefer-option-from-nullable.ts";
import noEffectAsvoid from "./rules/no-effect-asvoid.ts";
import pipeMaxArguments from "./rules/pipe-max-arguments.ts";
import noReexportOnlyModules from "./rules/no-reexport-only-modules.ts";
import noNestedYield from "./rules/no-nested-yield.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    sourceType: "module",
    parserOptions: {
      lang: "ts",
    },
  },
});

tester.run("no-type-assertion", noTypeAssertion, {
  valid: [
    "const value = value as const;",
    "const machine = setup({ types: { input: {} as { id: string }, context: {} as { id: string }, events: {} as { type: 'x' }, children: {} as { child: 'actor' }, output: {} as { id: string } } });",
    "const store = createStore({ context: { visited: false } as { visited: boolean }, on: {} });",
    "const value = input satisfies { id: string };",
  ],
  invalid: [
    {
      code: "const value = input as string;",
      errors: [/Avoid type assertions/],
    },
    {
      code: "const value = input as { id: string };",
      errors: [/Avoid type assertions/],
    },
    {
      code: "const value = <string>input;",
      errors: [/Avoid type assertions/],
    },
  ],
});

tester.run("no-banned-type-assertions", noBannedTypeAssertions, {
  valid: [
    "const value = input as string;",
    "const value = input as { id: string };",
    "const value = input satisfies unknown;",
    "const value = value as const;",
    "const value = <string>input;",
  ],
  invalid: [
    {
      code: "const value = input as any;",
      errors: [/Do not assert to any, never, or unknown/],
    },
    {
      code: "const value = input as never;",
      errors: [/Do not assert to any, never, or unknown/],
    },
    {
      code: "const value = input as unknown;",
      errors: [/Do not assert to any, never, or unknown/],
    },
    {
      code: "const value = <any>input;",
      errors: [/Do not assert to any, never, or unknown/],
    },
    {
      code: "const value = <never>input;",
      errors: [/Do not assert to any, never, or unknown/],
    },
    {
      code: "const value = <unknown>input;",
      errors: [/Do not assert to any, never, or unknown/],
    },
  ],
});

tester.run("no-optional-function-parameters", noOptionalFunctionParameters, {
  valid: [
    "function _save(value: string | undefined) { return value; }",
    "const _save = (value: string | null) => value;",
    "type Params = { value?: string };",
    "interface Params { value?: string }",
  ],
  invalid: [
    {
      code: "function _save(value?: string) { return value; }",
      errors: [/Optional function parameters are banned/],
    },
    {
      code: "const _save = (value?: string) => value;",
      errors: [/Optional function parameters are banned/],
    },
    {
      code: "class Service { constructor(private readonly value?: string) {} }",
      errors: [/Optional function parameters are banned/],
    },
  ],
});

tester.run("no-ambient-nondeterminism", noAmbientNondeterminism, {
  valid: [
    "Effect.gen(function* () { const crypto = yield* Crypto.Crypto; yield* crypto.randomUUIDv4; });",
    "const value = new Date(0);",
    {
      code: "const value = new Date(); const timestamp = Date.now();",
      filename: "/repo/applications/web/app/component.tsx",
    },
    {
      code: "const value = new Date(); const timestamp = Date.now();",
      filename: "/repo/applications/web/lib/format.ts",
      options: [{ allowedDateBasenames: ["format.ts"] }],
    },
  ],
  invalid: [
    {
      code: "const id = crypto.randomUUID();",
      errors: [/Do not use ambient crypto/],
    },
    {
      code: "const id = globalThis.crypto.randomUUID();",
      errors: [/Do not use ambient crypto/],
    },
    {
      code: "const value = Math.random();",
      errors: [/Do not use ambient Math.random/],
    },
    {
      code: "const value = new Date();",
      filename: "/repo/applications/server/src/service.ts",
      errors: [/Do not read the current time from ambient Date/],
    },
    {
      code: "const value = Date.now();",
      filename: "/repo/applications/server/src/service.ts",
      errors: [/Do not read the current time from ambient Date/],
    },
  ],
});

tester.run("no-direct-browser-storage", noDirectBrowserStorage, {
  valid: [
    "const store = KeyValueStore.KeyValueStore;",
    "const database = IndexedDb.IndexedDb;",
    "const localStore = custom.localStorage;",
    "const storageNames = { localStorage: 'local', sessionStorage: 'session', indexedDB: 'database' };",
    "import { indexedDB as fakeIndexedDb } from 'fake-indexeddb'; IndexedDb.make({ indexedDB: fakeIndexedDb, IDBKeyRange });",
  ],
  invalid: [
    {
      code: "localStorage.getItem('key');",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
    {
      code: "sessionStorage.setItem('key', value);",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
    {
      code: "const request = indexedDB.open('sample-cache');",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
    {
      code: "window.localStorage.removeItem('key');",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
    {
      code: "globalThis.sessionStorage.clear();",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
    {
      code: "const database = window['indexedDB'];",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
    {
      code: "cache[localStorage] = value;",
      errors: [/Use Effect's IndexedDb or KeyValueStore modules/],
    },
  ],
});

tester.run("no-direct-fetch", noDirectFetch, {
  valid: [
    "api.fetch({ id });",
    "sitemapService.fetch({ index });",
    "import { fetch as expoFetch } from 'expo/fetch'; expoFetch(url);",
  ],
  invalid: [
    {
      code: "fetch('/api');",
      errors: [/Do not call fetch directly/],
    },
    {
      code: "window.fetch('/api');",
      errors: [/Do not call fetch directly/],
    },
    {
      code: "globalThis.fetch('/api');",
      errors: [/Do not call fetch directly/],
    },
  ],
});

tester.run("no-disable-validation", noDisableValidation, {
  valid: [
    "Schema.decodeUnknown(schema, value, { disableValidation: false });",
    "Schema.decodeUnknown(schema, value, { validation: true });",
  ],
  invalid: [
    {
      code: "Schema.decodeUnknown(schema, value, { disableValidation: true });",
      errors: [/Do not use disableValidation: true/],
    },
    {
      code: "Schema.decodeUnknown(schema, value, { 'disableValidation': true });",
      errors: [/Do not use disableValidation: true/],
    },
  ],
});

tester.run("no-global-json", noGlobalJson, {
  valid: [
    "Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value);",
    "const codec = { JSON: { stringify: value => value } }; codec.JSON.stringify(value);",
  ],
  invalid: [
    {
      code: "JSON.stringify(value);",
      errors: [/Do not use the global JSON API/],
    },
    {
      code: "globalThis.JSON.parse(value);",
      errors: [/Do not use the global JSON API/],
    },
  ],
});

tester.run("no-in-operator", noInOperator, {
  valid: [
    "const supported = Object.hasOwn(navigator, 'wakeLock');",
    {
      code: "const supported = Object.hasOwn(node, 'type');",
      filename: "/repo/modules/oxc/src/oxlint/rules/example.ts",
    },
  ],
  invalid: [
    {
      code: "const supported = 'wakeLock' in navigator;",
      filename: "/repo/applications/web/src/example.ts",
      errors: [/Do not use the "in" operator/],
    },
  ],
});

tester.run("no-typeof-object", noTypeofObject, {
  valid: [
    "const valid = typeof value !== 'string';",
    {
      code: "const valid = node !== null;",
      filename: "/repo/modules/oxc/src/oxlint/rules/example.ts",
    },
  ],
  invalid: [
    {
      code: "const invalid = typeof value !== 'object';",
      filename: "/repo/applications/web/src/example.ts",
      errors: [/Do not compare typeof values with "object"/],
    },
    {
      code: "const invalid = typeof value === 'object';",
      filename: "/repo/applications/server/src/example.ts",
      errors: [/Do not compare typeof values with "object"/],
    },
    {
      code: "const invalid = 'object' !== typeof value;",
      filename: "/repo/modules/contracts/src/example.ts",
      errors: [/Do not compare typeof values with "object"/],
    },
    {
      code: "const invalid = typeof value != 'object';",
      filename: "/repo/modules/contracts/src/example.ts",
      errors: [/Do not compare typeof values with "object"/],
    },
    {
      code: "const invalid = value !== null && typeof value === 'object';",
      filename: "/repo/applications/web/src/example.ts",
      errors: [/Do not compare typeof values with "object"/],
    },
  ],
});

tester.run("no-try-catch", noTryCatch, {
  valid: [
    "Effect.try({ try: () => parse(value), catch: (cause) => new Error(String(cause)) });",
    "Effect.tryPromise({ try: () => request(), catch: (cause) => new Error(String(cause)) });",
  ],
  invalid: [
    {
      code: "try { parse(value); } catch { fallback(); }",
      errors: [/Do not use try\/catch/],
    },
  ],
});

tester.run("no-silent-error-swallow", noSilentErrorSwallow, {
  valid: [
    "effect.pipe(Effect.catch((error) => Effect.logError(error)));",
    "effect.pipe(Effect.catch(() => Effect.fail(error)));",
    "effect.pipe(Effect.catchTags({ NotFound: () => Effect.succeed(null) }));",
  ],
  invalid: [
    {
      code: "effect.pipe(Effect.catch(() => Effect.void));",
      errors: [/Do not silently swallow Effect errors/],
    },
    {
      code: "effect.pipe(Effect.catch(() => { return Effect.unit; }));",
      errors: [/Do not silently swallow Effect errors/],
    },
    {
      code: "effect.pipe(Effect.catchTags({ NotFound: () => Effect.void }));",
      errors: [/Do not silently swallow Effect errors/],
    },
  ],
});

tester.run("no-switch", noSwitch, {
  valid: [
    "const value = Match.value(input).pipe(Match.when('a', () => 1), Match.orElse(() => 2));",
    "if (input === 'a') { value = 1; }",
  ],
  invalid: [
    {
      code: "switch (input) { case 'a': value = 1; break; default: value = 2; }",
      errors: [/Switch statements are banned/],
    },
  ],
});

tester.run("no-service-option", noServiceOption, {
  valid: [
    "Effect.gen(function* () { const service = yield* CustomFetch; });",
    "Effect.gen(function* () { const service = yield* Effect.service(CustomFetch); });",
  ],
  invalid: [
    {
      code: "Effect.gen(function* () { const service = yield* Effect.serviceOption(CustomFetch); });",
      errors: [/Do not use Effect.serviceOption/],
    },
  ],
});

tester.run(
  "no-static-effect-service-forwarders",
  noStaticEffectServiceForwarders,
  {
    valid: [
      "import { Effect } from 'effect'; Effect.gen(function* () { const service = yield* Preferences; return yield* service.get; });",
      "import { Effect } from 'effect'; class Preferences { static readonly get = Effect.flatMap(Effect.service(this), (_) => { const value = _.get; return Effect.succeed(value); }); }",
      "import { Effect } from 'effect'; const get = Effect.flatMap(Effect.service(this), (_) => _.get);",
      "import { Effect } from 'effect'; class Preferences { static readonly get = (() => { const Effect = customEffect; return Effect.flatMap(Effect.service(this), (_) => _.get); })(); }",
      "class Preferences { static readonly get = Effect.flatMap(Effect.service(this), (_) => _.get); }",
    ],
    invalid: [
      {
        code: "import { Effect } from 'effect'; class Preferences { static readonly get = Effect.flatMap(Effect.service(this), (_) => _.get); }",
        errors: [
          /Do not expose an Effect service method through a static forwarder/,
        ],
      },
      {
        code: "import { Effect as Fx } from 'effect'; class Preferences { static readonly get = (input) => Fx.flatMap(Fx.service(this), (service) => service.get(input)); }",
        errors: [
          /Do not expose an Effect service method through a static forwarder/,
        ],
      },
      {
        code: "import { Effect } from 'effect'; class Preferences { static readonly get = Effect.service(this).pipe(Effect.flatMap((_) => _.get)); }",
        errors: [
          /Do not expose an Effect service method through a static forwarder/,
        ],
      },
      {
        code: "import { Effect, pipe as compose } from 'effect'; class Preferences { static readonly get = compose(Effect.service(this), Effect.flatMap((_) => { return _.get; })); }",
        errors: [
          /Do not expose an Effect service method through a static forwarder/,
        ],
      },
      {
        code: "import { flatMap as chain, service as acquire } from 'effect/Effect'; class Preferences { static readonly get = chain(acquire(this), (_) => _.get()); }",
        errors: [
          /Do not expose an Effect service method through a static forwarder/,
        ],
      },
      {
        code: "import * as Fx from 'effect/Effect'; class Preferences { static readonly get = Fx.flatMap(Fx.service(this), (_) => _.get); }",
        errors: [
          /Do not expose an Effect service method through a static forwarder/,
        ],
      },
    ],
  }
);

tester.run(
  "require-context-service-in-services",
  requireContextServiceInServices,
  {
    valid: [
      {
        code: "export class UserService extends Context.Service<UserService>()('UserService', { effect: Effect.void }) {}",
        filename: "/repo/applications/server/src/services/user-service.ts",
      },
      {
        code: "export const layer = Layer.empty;",
        filename:
          "/repo/applications/server/test/services/user-service.test.ts",
      },
      {
        code: "export * from './user-service';",
        filename: "/repo/modules/services-layer/src/main.ts",
      },
      {
        code: "export const formatValue = (value: string) => value.trim();",
        filename: "modules/services-layer/src/utils.ts",
      },
      {
        code: "export const layer = Layer.empty;",
        filename: "/repo/applications/server/src/layers/user-layer.ts",
      },
    ],
    invalid: [
      {
        code: "export const layer = Layer.empty;",
        filename: "/repo/applications/server/src/services/user-layer.ts",
        errors: [/must define a class extending Context.Service/],
      },
    ],
  }
);

tester.run("no-nested-layer-provide", noNestedLayerProvide, {
  valid: [
    "Layer.provide(AppLayer, DependenciesLayer);",
    "Layer.provideMerge(AppLayer, DependenciesLayer);",
  ],
  invalid: [
    {
      code: "Layer.provide(AppLayer, Layer.provide(ServiceLayer, DependenciesLayer));",
      errors: [/Avoid nested Layer.provide calls/],
    },
  ],
});

tester.run("no-cascading-layer-provide", noCascadingLayerProvide, {
  valid: [
    'import { Layer } from "effect"; Service.layer.pipe(Layer.provide([Repository.layer, Client.layer]));',
    'import { Layer } from "effect"; const ConfiguredRuntime = Runtime.layer.pipe(Layer.provide(Config.layer)); App.layer.pipe(Layer.provide(ConfiguredRuntime));',
    'import { Layer as EffectLayer } from "effect"; Service.layer.pipe(EffectLayer.provide([Repository.layer, Client.layer]));',
    "const Layer = { provide: (layer: unknown) => layer }; Service.layer.pipe(Layer.provide(Repository.layer), Layer.provide(Client.layer));",
  ],
  invalid: [
    {
      code: 'import { Layer } from "effect"; Service.layer.pipe(Layer.provide(Repository.layer), Layer.provide(Client.layer));',
      errors: [/Avoid multiple Layer\.provide/],
    },
    {
      code: 'import { Layer } from "effect"; Service.layer.pipe(Layer.provide(Repository.layer), Layer.provideMerge(Client.layer));',
      errors: [/Avoid multiple Layer\.provide/],
    },
    {
      code: 'import { Layer as EffectLayer } from "effect"; Service.layer.pipe(EffectLayer.provide(Repository.layer), EffectLayer.provide(Client.layer));',
      errors: [/Avoid multiple Layer\.provide/],
    },
  ],
});

tester.run("no-nested-effect-array-methods", noNestedEffectArrayMethods, {
  valid: [
    "import { Array } from 'effect'; Array.filter(values, predicate);",
    "import { Array as EffectArray } from 'effect'; EffectArray.filter(values, value => Array.contains(ids, value.id));",
    "import { Array } from 'effect'; const contains = Array.contains(ids); Array.filter(values, value => contains(value.id));",
  ],
  invalid: [
    {
      code: "import { Array } from 'effect'; Array.filter(values, value => Array.contains(ids, value.id));",
      errors: [/Do not nest Effect Array method calls/],
    },
    {
      code: "import { Array } from 'effect'; Array.map(Array.filter(values, predicate), mapper);",
      errors: [/Do not nest Effect Array method calls/],
    },
  ],
});

tester.run("no-shadowed-standard-array-static", noShadowedStandardArrayStatic, {
  valid: [
    "Array.from(values);",
    "import { Array as EffectArray } from 'effect'; Array.from(values); EffectArray.map(values, value => value);",
    "import { Array } from 'effect'; globalThis.Array.from(values);",
    "import { Array } from 'effect'; Array.map(values, value => value);",
  ],
  invalid: [
    {
      code: "import { Array } from 'effect'; Array.from(values);",
      errors: [/Use globalThis.Array/],
    },
    {
      code: "import { Array } from 'effect'; Array.isArray(values);",
      errors: [/Use globalThis.Array/],
    },
    {
      code: "import { Array } from 'effect'; Array.of(value);",
      errors: [/Use globalThis.Array/],
    },
  ],
});

tester.run("prefer-option-from-nullable", preferOptionFromNullable, {
  valid: [
    "const value = Option.fromNullable(input);",
    "const value = input === null ? Option.none() : Option.some(input);",
    "const value = input !== undefined ? Option.some(input) : Option.none();",
  ],
  invalid: [
    {
      code: "const value = input !== null ? Option.some(input) : Option.none();",
      errors: [/Use Option.fromNullable/],
    },
    {
      code: "const value = null != input ? Option.some(input) : Option.none();",
      errors: [/Use Option.fromNullable/],
    },
    {
      code: "const value = input !== null ? Option.some<string>(input) : Option.none();",
      errors: [/Use Option.fromNullable/],
    },
  ],
});

tester.run("no-effect-asvoid", noEffectAsvoid, {
  valid: [
    "program.pipe(Effect.as(undefined));",
    "Effect.as(undefined)(program);",
  ],
  invalid: [
    {
      code: "program.pipe(Effect.asVoid);",
      errors: [/Avoid Effect.asVoid/],
    },
    {
      code: "Effect.asVoid(program);",
      errors: [/Avoid Effect.asVoid/],
    },
  ],
});

tester.run("pipe-max-arguments", pipeMaxArguments, {
  valid: [
    "effect.pipe(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20);",
  ],
  invalid: [
    {
      code: "effect.pipe(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21);",
      errors: [/This pipe has too many arguments/],
    },
  ],
});

tester.run("no-reexport-only-modules", noReexportOnlyModules, {
  valid: [
    {
      code: "export { Component };",
      filename: "/repo/applications/web/components/component.ts",
    },
    {
      code: "export { Component } from './component'; export const name = 'component';",
      filename: "/repo/applications/web/components/component.ts",
    },
    {
      code: "export { default } from '../shared/loading';",
      filename: "/repo/applications/web/app/account/loading.tsx",
    },
    {
      code: "export { default } from '../shared/not-found';",
      filename: "/repo/applications/web/app/account/not-found.tsx",
    },
    {
      code: "",
      filename: "/repo/applications/web/components/empty.ts",
    },
  ],
  invalid: [
    {
      code: "export * from './components';",
      filename: "/repo/applications/web/components/index.ts",
      errors: [/Do not create re-export-only modules/],
    },
    {
      code: "export { Button } from './button'; export type { ButtonProps } from './button';",
      filename: "/repo/applications/web/components/public.ts",
      errors: [/Do not create re-export-only modules/],
    },
    {
      code: "export { Button as Action } from './button';",
      filename: "/repo/applications/web/components/renamed.ts",
      errors: [/Do not create re-export-only modules/],
    },
    {
      code: "export { default } from '../../account/page';",
      filename: "/repo/applications/web/app/settings/page.tsx",
      errors: [/Do not create re-export-only modules/],
    },
    {
      code: "'use client'; export { default } from './component';",
      filename: "/repo/applications/web/components/client-component.tsx",
      errors: [/Do not create re-export-only modules/],
    },
    {
      code: "export * as Components from './components';",
      filename: "/repo/modules/example/src/main.ts",
      errors: [/Do not create re-export-only modules/],
    },
  ],
});

tester.run("no-nested-yield", noNestedYield, {
  valid: [
    "function* run() { const auth = yield* Auth; const identity = yield* auth.getUserIdentity; }",
    "function* run() { yield* Effect.gen(function* () { yield* inner; }); }",
    "function* run() { yield* Effect.forEach(items, (item) => Effect.gen(function* () { yield* save(item); })); }",
  ],
  invalid: [
    {
      code: "function* run() { const identity = yield* (yield* Auth).getUserIdentity; }",
      errors: [/Avoid nesting yield\*/],
    },
    { code: "function* run() { yield* save(yield* load); }", errors: [/Avoid nesting yield\*/] },
  ],
});
