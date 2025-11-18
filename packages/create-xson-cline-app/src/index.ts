#!/usr/bin/env node

import { program } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import validatePackageName from 'validate-npm-package-name';
import { execSync } from 'child_process';

interface ProjectOptions {
  name: string;
  template: string;
  packageManager: 'npm' | 'yarn' | 'pnpm';
  git: boolean;
  install: boolean;
}

const TEMPLATES = ['default', 'mcp-server', 'cli-tool', 'vscode-extension'];

async function validateProjectName(name: string): Promise<boolean> {
  const validation = validatePackageName(name);
  if (!validation.validForNewPackages) {
    const errors = [...(validation.errors || []), ...(validation.warnings || [])];
    console.error(chalk.red(`Invalid project name: ${name}`));
    errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
    return false;
  }
  return true;
}

async function createProject(projectName: string, options: Partial<ProjectOptions>) {
  console.log(chalk.cyan('\n🚀 Create XSON Cline App\n'));

  // Validate project name
  if (!(await validateProjectName(projectName))) {
    process.exit(1);
  }

  // Check if directory already exists
  const projectPath = path.resolve(process.cwd(), projectName);
  if (fs.existsSync(projectPath)) {
    console.error(chalk.red(`Error: Directory "${projectName}" already exists.`));
    process.exit(1);
  }

  // Prompt for missing options
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'template',
      message: 'Select a template:',
      choices: TEMPLATES,
      default: 'default',
      when: !options.template,
    },
    {
      type: 'list',
      name: 'packageManager',
      message: 'Select a package manager:',
      choices: ['npm', 'yarn', 'pnpm'],
      default: 'npm',
      when: !options.packageManager,
    },
    {
      type: 'confirm',
      name: 'git',
      message: 'Initialize git repository?',
      default: true,
      when: options.git === undefined,
    },
    {
      type: 'confirm',
      name: 'install',
      message: 'Install dependencies?',
      default: true,
      when: options.install === undefined,
    },
  ]);

  const projectOptions: ProjectOptions = {
    name: projectName,
    template: options.template || answers.template,
    packageManager: (options.packageManager || answers.packageManager) as 'npm' | 'yarn' | 'pnpm',
    git: options.git !== undefined ? options.git : answers.git,
    install: options.install !== undefined ? options.install : answers.install,
  };

  // Create project
  const spinner = ora('Creating project...').start();

  try {
    // Create project directory
    await fs.ensureDir(projectPath);

    // Copy template files
    const templatePath = path.join(__dirname, '..', 'templates', projectOptions.template);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template "${projectOptions.template}" not found`);
    }

    await fs.copy(templatePath, projectPath);

    // Update package.json with project name
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      packageJson.name = projectName;
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
    }

    spinner.succeed('Project created!');

    // Initialize git
    if (projectOptions.git) {
      const gitSpinner = ora('Initializing git repository...').start();
      try {
        execSync('git init', { cwd: projectPath, stdio: 'ignore' });
        execSync('git add -A', { cwd: projectPath, stdio: 'ignore' });
        execSync('git commit -m "Initial commit from create-xson-cline-app"', {
          cwd: projectPath,
          stdio: 'ignore',
        });
        gitSpinner.succeed('Git repository initialized!');
      } catch (error) {
        gitSpinner.fail('Failed to initialize git repository');
      }
    }

    // Install dependencies
    if (projectOptions.install) {
      const installSpinner = ora('Installing dependencies...').start();
      try {
        const installCmd = projectOptions.packageManager === 'yarn'
          ? 'yarn install'
          : projectOptions.packageManager === 'pnpm'
          ? 'pnpm install'
          : 'npm install';

        execSync(installCmd, { cwd: projectPath, stdio: 'ignore' });
        installSpinner.succeed('Dependencies installed!');
      } catch (error) {
        installSpinner.fail('Failed to install dependencies');
        console.log(chalk.yellow('\nYou can install dependencies manually by running:'));
        console.log(chalk.cyan(`  cd ${projectName}`));
        console.log(chalk.cyan(`  ${projectOptions.packageManager} install`));
      }
    }

    // Success message
    console.log(chalk.green('\n✨ Success! Created ' + projectName + ' at ' + projectPath));
    console.log('\nInside that directory, you can run several commands:\n');

    const runCmd = projectOptions.packageManager === 'npm' ? 'npm run' : projectOptions.packageManager;
    console.log(chalk.cyan(`  ${runCmd} dev`));
    console.log('    Starts the development server.\n');
    console.log(chalk.cyan(`  ${runCmd} build`));
    console.log('    Builds the app for production.\n');
    console.log(chalk.cyan(`  ${runCmd} test`));
    console.log('    Runs the test suite.\n');

    console.log('We suggest that you begin by typing:\n');
    console.log(chalk.cyan('  cd'), projectName);
    if (!projectOptions.install) {
      console.log(chalk.cyan(`  ${projectOptions.packageManager} install`));
    }
    console.log(chalk.cyan(`  ${runCmd} dev`));
    console.log();

  } catch (error) {
    spinner.fail('Failed to create project');
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));

    // Clean up on failure
    if (fs.existsSync(projectPath)) {
      await fs.remove(projectPath);
    }

    process.exit(1);
  }
}

// CLI setup
program
  .name('create-xson-cline-app')
  .description('Create a new XSON Cline application')
  .version('1.0.0')
  .argument('[project-name]', 'Name of your project')
  .option('-t, --template <template>', `Template to use (${TEMPLATES.join(', ')})`)
  .option('-p, --package-manager <pm>', 'Package manager to use (npm, yarn, pnpm)')
  .option('--no-git', 'Skip git initialization')
  .option('--no-install', 'Skip dependency installation')
  .action(async (projectName?: string, options?: any) => {
    if (!projectName) {
      const { name } = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'What is your project name?',
          default: 'my-xson-cline-app',
        },
      ]);
      projectName = name;
    }

    if (!projectName) {
      console.error(chalk.red('Error: Project name is required'));
      process.exit(1);
    }

    await createProject(projectName, options || {});
  });

program.parse();
