import noAmbientNondeterminism from "./rules/no-ambient-nondeterminism.ts";
import noBannedTypeAssertions from "./rules/no-banned-type-assertions.ts";
import noCascadingLayerProvide from "./rules/no-cascading-layer-provide.ts";
import noDirectBrowserStorage from "./rules/no-direct-browser-storage.ts";
import noDirectFetch from "./rules/no-direct-fetch.ts";
import noDisableValidation from "./rules/no-disable-validation.ts";
import noEffectAsvoid from "./rules/no-effect-asvoid.ts";
import noGlobalJson from "./rules/no-global-json.ts";
import noInOperator from "./rules/no-in-operator.ts";
import noNestedEffectArrayMethods from "./rules/no-nested-effect-array-methods.ts";
import noNestedLayerProvide from "./rules/no-nested-layer-provide.ts";
import noNestedYield from "./rules/no-nested-yield.ts";
import noOptionalFunctionParameters from "./rules/no-optional-function-parameters.ts";
import noReexportOnlyModules from "./rules/no-reexport-only-modules.ts";
import noServiceOption from "./rules/no-service-option.ts";
import noShadowedStandardArrayStatic from "./rules/no-shadowed-standard-array-static.ts";
import noSilentErrorSwallow from "./rules/no-silent-error-swallow.ts";
import noStaticEffectServiceForwarders from "./rules/no-static-effect-service-forwarders.ts";
import noSwitch from "./rules/no-switch.ts";
import noTryCatch from "./rules/no-try-catch.ts";
import noTypeAssertion from "./rules/no-type-assertion.ts";
import noTypeofObject from "./rules/no-typeof-object.ts";
import pipeMaxArguments from "./rules/pipe-max-arguments.ts";
import preferOptionFromNullable from "./rules/prefer-option-from-nullable.ts";
import requireContextServiceInServices from "./rules/require-context-service-in-services.ts";
import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

interface Plugin {
  readonly meta: {
    readonly name: string;
  };
  readonly rules: Readonly<Record<string, Rule>>;
}

const plugin: Plugin = {
  meta: {
    name: "automation",
  },
  rules: {
    "no-ambient-nondeterminism": noAmbientNondeterminism,
    "no-banned-type-assertions": noBannedTypeAssertions,
    "no-cascading-layer-provide": noCascadingLayerProvide,
    "no-direct-browser-storage": noDirectBrowserStorage,
    "no-direct-fetch": noDirectFetch,
    "no-disable-validation": noDisableValidation,
    "no-effect-asvoid": noEffectAsvoid,
    "no-global-json": noGlobalJson,
    "no-in-operator": noInOperator,
    "no-nested-effect-array-methods": noNestedEffectArrayMethods,
    "no-nested-layer-provide": noNestedLayerProvide,
    "no-nested-yield": noNestedYield,
    "no-optional-function-parameters": noOptionalFunctionParameters,
    "no-reexport-only-modules": noReexportOnlyModules,
    "no-service-option": noServiceOption,
    "no-shadowed-standard-array-static": noShadowedStandardArrayStatic,
    "no-silent-error-swallow": noSilentErrorSwallow,
    "no-static-effect-service-forwarders": noStaticEffectServiceForwarders,
    "no-switch": noSwitch,
    "no-try-catch": noTryCatch,
    "no-type-assertion": noTypeAssertion,
    "no-typeof-object": noTypeofObject,
    "pipe-max-arguments": pipeMaxArguments,
    "prefer-option-from-nullable": preferOptionFromNullable,
    "require-context-service-in-services": requireContextServiceInServices,
  },
};

export default plugin;
