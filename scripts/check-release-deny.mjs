#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function isContained(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function exported(node) {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function unwrap(expression) {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression;
  return value;
}

function exactLiteral(expression, expected) {
  if (!expression) return false;
  const value = unwrap(expression);
  if (typeof expected === "boolean") {
    return (
      value.kind ===
      (expected ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword)
    );
  }
  return ts.isStringLiteral(value) && value.text === expected;
}

function sourceFile(path, text, failures) {
  const parsed = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const diagnostic of parsed.parseDiagnostics) {
    failures.push(
      `${path} must parse as TypeScript (${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}).`,
    );
  }
  return parsed;
}

function assertExportedConst(parsed, path, name, expected, failures) {
  const declarations = [];
  for (const statement of parsed.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !exported(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        declarations.push(declaration);
    }
  }
  if (
    declarations.length !== 1 ||
    !exactLiteral(declarations[0]?.initializer, expected)
  ) {
    failures.push(
      `${path} must keep exactly one active exported const ${name} at ${JSON.stringify(expected)}.`,
    );
  }
}

function assertExportedUnconditionalThrowFunction(
  parsed,
  path,
  name,
  message,
  failures,
) {
  const matches = parsed.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      exported(statement) &&
      statement.name?.text === name,
  );
  const body = matches.length === 1 ? matches[0].body : undefined;
  const statement = body?.statements.length === 1 ? body.statements[0] : undefined;
  const expression = statement && ts.isThrowStatement(statement)
    ? unwrap(statement.expression)
    : undefined;
  if (
    !expression ||
    !ts.isNewExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "Error" ||
    expression.arguments?.length !== 1 ||
    !exactLiteral(expression.arguments[0], message)
  ) failures.push(`${path} must keep exported ${name} as one active unconditional reviewed throw.`);
}

function assertNoVerifierConstructionExports(parsed, path, failures) {
  const forbidden = [];
  for (const statement of parsed.statements) {
    if (!exported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && /(?:create|compose|register).*configured.*verifier|configured.*verifier.*(?:create|compose|register)/i.test(statement.name.text))
      forbidden.push(statement.name.text);
    if (ts.isClassDeclaration(statement) && statement.name && /configured.*verifier/i.test(statement.name.text))
      forbidden.push(statement.name.text);
  }
  if (forbidden.length) failures.push(`${path} must not export a configured-verifier constructor, composer, registration API, or class.`);
}

function assertUnconditionalFalseFunction(parsed, path, name, failures) {
  const matches = parsed.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      exported(statement) &&
      statement.name?.text === name,
  );
  const body = matches.length === 1 ? matches[0].body : undefined;
  if (
    !body ||
    body.statements.length !== 1 ||
    !ts.isReturnStatement(body.statements[0]) ||
    !exactLiteral(body.statements[0].expression, false)
  )
    failures.push(
      `${path} must keep ${name} as one active unconditional return false.`,
    );
}

function assertPrivateUnconditionalThrowFunction(
  parsed,
  path,
  name,
  message,
  failures,
) {
  const matches = parsed.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      !exported(statement) &&
      statement.name?.text === name,
  );
  const body = matches.length === 1 ? matches[0].body : undefined;
  const statement =
    body?.statements.length === 1 ? body.statements[0] : undefined;
  const expression =
    statement && ts.isThrowStatement(statement)
      ? unwrap(statement.expression)
      : undefined;
  if (
    !expression ||
    !ts.isNewExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "Error" ||
    expression.arguments?.length !== 1 ||
    !exactLiteral(expression.arguments[0], message)
  )
    failures.push(
      `${path} must keep private ${name} as one active unconditional reviewed throw.`,
    );
}

function assertNullSelectorManifest(
  parsed,
  path,
  name,
  expectedCount,
  failures,
) {
  const declarations = [];
  for (const statement of parsed.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !exported(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        declarations.push(declaration);
    }
  }
  const selectors = [];
  if (declarations.length === 1 && declarations[0].initializer) {
    const visit = (node) => {
      if (
        ts.isPropertyAssignment(node) &&
        ((ts.isIdentifier(node.name) && node.name.text === "selector") ||
          (ts.isStringLiteral(node.name) && node.name.text === "selector"))
      )
        selectors.push(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(declarations[0].initializer);
  }
  if (
    declarations.length !== 1 ||
    selectors.length !== expectedCount ||
    selectors.some(
      (selector) => unwrap(selector).kind !== ts.SyntaxKind.NullKeyword,
    )
  )
    failures.push(
      `${path} must keep all ${expectedCount} ${name} entrypoint/event selectors explicitly null.`,
    );
}

function jsonc(path, text, failures) {
  const parsed = ts.parseConfigFileTextToJson(path, text);
  if (parsed.error) {
    failures.push(
      `${path} must remain structurally valid JSONC (${ts.flattenDiagnosticMessageText(parsed.error.messageText, " ")}).`,
    );
    return undefined;
  }
  return parsed.config;
}

function collectProperty(object, property, values) {
  if (!object || typeof object !== "object") return;
  if (!Array.isArray(object) && Object.hasOwn(object, property))
    values.push(object[property]);
  for (const value of Object.values(object))
    collectProperty(value, property, values);
}

async function checkedSource(root, path, failures) {
  const candidate = resolve(root, path);
  if (!isContained(root, candidate)) {
    failures.push(`${path} resolves outside the repository.`);
    return undefined;
  }
  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT")
      failures.push(`${path} is required by the release-deny policy.`);
    else throw error;
    return undefined;
  }
  if (metadata.isSymbolicLink()) {
    failures.push(`${path} must not be a symbolic link.`);
    return undefined;
  }
  const canonical = await realpath(candidate);
  if (!isContained(root, canonical)) {
    failures.push(`${path} resolves outside the repository.`);
    return undefined;
  }
  return readFile(canonical, "utf8");
}

async function assertAbsent(root, path, failures) {
  const candidate = resolve(root, path);
  if (!isContained(root, candidate)) {
    failures.push(`${path} resolves outside the repository.`);
    return;
  }
  try {
    await lstat(candidate);
    failures.push(`${path} must remain absent (including symlinks).`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function checkReleaseDeny(root = repositoryRoot) {
  const canonicalRoot = await realpath(resolve(root));
  const failures = [];
  await assertAbsent(canonicalRoot, "scripts/deploy-mail-mainnet.sh", failures);

  const constantsPath = "src/utils/constants.ts";
  const constantsText = await checkedSource(
    canonicalRoot,
    constantsPath,
    failures,
  );
  if (constantsText !== undefined) {
    const parsed = sourceFile(constantsPath, constantsText, failures);
    for (const name of [
      "mailHelperSepolia",
      "mailHelperMainnet",
      "escrowHelperSepolia",
      "escrowHelperMainnet",
    ]) {
      assertExportedConst(parsed, constantsPath, name, "0x0", failures);
    }
  }

  const relayPath = "workers/relay/src/index.ts";
  const relayText = await checkedSource(canonicalRoot, relayPath, failures);
  if (relayText !== undefined) {
    assertExportedConst(
      sourceFile(relayPath, relayText, failures),
      relayPath,
      "RFQ_TRANSPORT_ENABLED",
      false,
      failures,
    );
  }

  const wranglerPath = "wrangler.jsonc";
  const wranglerText = await checkedSource(
    canonicalRoot,
    wranglerPath,
    failures,
  );
  if (wranglerText !== undefined) {
    const parsed = jsonc(wranglerPath, wranglerText, failures);
    if (parsed !== undefined) {
      const values = [];
      collectProperty(parsed, "RFQ_TRANSPORT_ENABLED", values);
      if (values.length === 0 || values.some((value) => value !== "false")) {
        failures.push(
          `${wranglerPath} must keep every effective RFQ_TRANSPORT_ENABLED value at "false".`,
        );
      }
    }
  }

  const productionPath = "src/app/rfq/production-private-intents.ts";
  const productionText = await checkedSource(
    canonicalRoot,
    productionPath,
    failures,
  );
  if (productionText !== undefined) {
    const parsed = sourceFile(productionPath, productionText, failures);
    for (const name of [
      "PRODUCTION_RFQ_TRANSPORT_ENABLED",
      "PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE",
      "PRODUCTION_RFQ_PUBLIC_FALLBACK",
    ]) assertExportedConst(parsed, productionPath, name, false, failures);
  }

  const receiptVerifierPath = "src/lib/settlement-receipt-chain.ts";
  const receiptVerifierText = await checkedSource(
    canonicalRoot,
    receiptVerifierPath,
    failures,
  );
  if (receiptVerifierText !== undefined) {
    const parsed = sourceFile(receiptVerifierPath, receiptVerifierText, failures);
    assertExportedUnconditionalThrowFunction(
      parsed,
      receiptVerifierPath,
      "executeConfiguredChainVerifier",
      "Configured-chain receipt authority is unavailable until the runtime-provenanced server verifier is composed.",
      failures,
    );
    assertNoVerifierConstructionExports(parsed, receiptVerifierPath, failures);
  }

  const validatorPath = "src/lib/sepolia-rfq-manifest.ts";
  const validatorText = await checkedSource(
    canonicalRoot,
    validatorPath,
    failures,
  );
  if (validatorText !== undefined) {
    assertUnconditionalFalseFunction(
      sourceFile(validatorPath, validatorText, failures),
      validatorPath,
      "validateSepoliaRfqManifest",
      failures,
    );
  }

  const vnextManifestPath = "src/lib/escrow-vnext.ts";
  const vnextManifestText = await checkedSource(
    canonicalRoot,
    vnextManifestPath,
    failures,
  );
  if (vnextManifestText !== undefined) {
    const parsed = sourceFile(vnextManifestPath, vnextManifestText, failures);
    assertExportedConst(
      parsed,
      vnextManifestPath,
      "LOCALNET_ESCROW_V2_IS_VNEXT",
      false,
      failures,
    );
    assertNullSelectorManifest(
      parsed,
      vnextManifestPath,
      "ESCROW_VNEXT_ABI_EXPECTATION",
      5,
      failures,
    );
  }

  const vnextActionsPath = "src/lib/escrow-vnext-actions.ts";
  const vnextActionsText = await checkedSource(
    canonicalRoot,
    vnextActionsPath,
    failures,
  );
  if (vnextActionsText !== undefined) {
    assertPrivateUnconditionalThrowFunction(
      sourceFile(vnextActionsPath, vnextActionsText, failures),
      vnextActionsPath,
      "acceptedGeneratedOperation",
      "An accepted generated EscrowOperationV1 encoder is not configured.",
      failures,
    );
  }

  const vnextRecoveryPath = "src/lib/escrow-vnext-recovery.ts";
  const vnextRecoveryText = await checkedSource(
    canonicalRoot,
    vnextRecoveryPath,
    failures,
  );
  if (vnextRecoveryText !== undefined) {
    assertPrivateUnconditionalThrowFunction(
      sourceFile(vnextRecoveryPath, vnextRecoveryText, failures),
      vnextRecoveryPath,
      "assertConfiguredRecoveryAuthority",
      "Configured VNext recovery authority is unavailable until trusted attempt, clock, and quorum-verifier adapters are composed.",
      failures,
    );
  }

  const templatePath = "deployments/sepolia/deployment-manifest.template.json";
  const templateText = await checkedSource(
    canonicalRoot,
    templatePath,
    failures,
  );
  if (templateText !== undefined) {
    let template;
    try {
      template = JSON.parse(templateText);
    } catch {
      failures.push(`${templatePath} must remain valid JSON.`);
    }
    if (template && template.releaseReady !== false)
      failures.push("Sepolia releaseReady must remain false.");
    if (/MockErc20/i.test(templateText))
      failures.push(
        "Sepolia deployment template must not reference MockErc20.",
      );
  }

  return failures;
}

export function printReleaseDenyResult(failures) {
  if (failures.length) {
    console.error("APP20 release-deny policy failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    return false;
  }
  console.log(
    "APP20 release-deny policy passed: public RFQ, live helpers, VNext execution, and Mainnet tooling remain disabled.",
  );
  return true;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : repositoryRoot;
  if (!printReleaseDenyResult(await checkReleaseDeny(root)))
    process.exitCode = 1;
}
