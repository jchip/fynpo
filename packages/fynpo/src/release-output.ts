import Chalk from "chalk";

const LINE = "─".repeat(60);

export function printHeader(title: string): void {
  console.log();
  console.log(Chalk.cyan(LINE));
  console.log(Chalk.cyan.bold(`  ${title}`));
  console.log(Chalk.cyan(LINE));
  console.log();
}

export function printSection(title: string): void {
  console.log();
  console.log(Chalk.yellow(`▸ ${title}`));
}

export function printList(items: string[], indent = 2): void {
  const pad = " ".repeat(indent);
  items.forEach((item) => {
    console.log(`${pad}${Chalk.green("•")} ${item}`);
  });
}

export function printSuccess(message: string): void {
  console.log();
  console.log(Chalk.green.bold(`✓ ${message}`));
}

export function printWarning(message: string): void {
  console.log(Chalk.yellow(`⚠ ${message}`));
}

export function printError(message: string): void {
  console.log(Chalk.red.bold(`✗ ${message}`));
}

export function printNextSteps(steps: string[]): void {
  console.log();
  console.log(Chalk.cyan(LINE));
  console.log(Chalk.cyan.bold("  Next Steps"));
  console.log(Chalk.cyan(LINE));
  steps.forEach((step, idx) => {
    console.log(`  ${Chalk.white.bold(`${idx + 1}.`)} ${step}`);
  });
  console.log();
}

export function printCommand(cmd: string): string {
  return Chalk.yellow(cmd);
}
