import type { RuleTester } from "oxlint/plugins-dev"

type Rule = Parameters<RuleTester["run"]>[1]

const message =
  "Avoid nesting yield* inside another yield*. Bind the inner result to a named const first."

const functionBoundaries = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
])

const rule: Rule = {
  meta: {
    type: "suggestion" as const,
    docs: {
      description: "Disallow yield* inside the operand of another yield* in the same generator.",
    },
  },
  create(context) {
    return {
      YieldExpression(node) {
        if (!node.delegate) {
          return
        }

        let ancestor: typeof node.parent | null = node.parent

        while (ancestor !== null && !functionBoundaries.has(ancestor.type)) {
          if (ancestor.type === "YieldExpression" && ancestor.delegate) {
            context.report({ node, message })

            return
          }

          ancestor = ancestor.parent
        }
      },
    }
  },
}

export default rule
