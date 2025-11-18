#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

program
  .name('cli-tool')
  .description('A CLI tool powered by Cline')
  .version('0.1.0');

program
  .command('hello')
  .description('Say hello')
  .argument('[name]', 'Name to greet', 'World')
  .action((name: string) => {
    console.log(chalk.green(`Hello, ${name}! 👋`));
  });

program
  .command('work')
  .description('Do some work')
  .action(async () => {
    const spinner = ora('Working...').start();

    await new Promise(resolve => setTimeout(resolve, 2000));

    spinner.succeed('Work completed!');
  });

program.parse();
