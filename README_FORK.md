# Cline-Fork 简易开发说明

这是基于 Cline fork 的本地二次开发版本。目前已验证可以修改源码、启动开发版、打包 VSIX，并看到自定义命令效果。

## 1. 环境要求

建议使用：

```bash
node -v
# v22.x.x

bun -v
# 1.3.x
```

如果没有安装依赖：

```bash
brew install mise git-lfs
git lfs install

cd /Users/myfile/Documents/cline
mise trust
mise install
```

## 2. 安装依赖

```bash
cd /Users/myfile/Documents/cline/apps/vscode
npm run install:all
npm run protos

cd /Users/myfile/Documents/cline/sdk
bun run build
```

## 3. 开发模式运行

打开一个终端，启动 watch 编译：

```bash
cd /Users/myfile/Documents/cline/apps/vscode
npm run dev
```

看到下面内容说明编译成功：

```text
Found 0 errors. Watching for file changes.
```

然后用 VS Code 打开 Cline 源码：

```bash
cd /Users/myfile/Documents/cline
code .
```

在 VS Code 里按 `F5`，会打开一个新的窗口：

```text
[Extension Development Host]
```

这个窗口运行的是本地开发版 Cline。

## 4. 验证自定义修改

本 fork 增加了一个命令：

```text
Cline-Fork: Show Dev Info
```

在 `[Extension Development Host]` 窗口里按：

```text
Cmd + Shift + P
```

搜索并运行：

```text
Cline-Fork: Show Dev Info
```

如果弹出提示，说明本地修改已经生效。

## 5. 编译检查

如果要正式打包，先停止 `npm run dev`：

```text
Ctrl + C
```

然后执行：

```bash
cd /Users/myfile/Documents/cline/apps/vscode
npm run compile
npm run check-types
```

## 6. 打包 VSIX

```bash
cd /Users/myfile/Documents/cline/apps/vscode
npx @vscode/vsce package --out ~/Desktop/cline-fork-dev.vsix
```

生成文件：

```text
~/Desktop/cline-fork-dev.vsix
```

## 7. 安装打包后的版本测试

建议使用隔离环境，避免影响正式 VS Code：

```bash
mkdir -p ~/tmp/cline-fork-profile ~/tmp/cline-fork-extensions

code \
  --user-data-dir ~/tmp/cline-fork-profile \
  --extensions-dir ~/tmp/cline-fork-extensions \
  --install-extension ~/Desktop/cline-fork-dev.vsix
```

打开测试项目：

```bash
code \
  --user-data-dir ~/tmp/cline-fork-profile \
  --extensions-dir ~/tmp/cline-fork-extensions \
  ~/Documents/cline-test
```

然后再次运行：

```text
Cmd + Shift + P
Cline-Fork: Show Dev Info
```

如果能看到弹窗，说明打包版本也包含了本地修改。

## 8. 常用开发流程

```text
修改源码
-> npm run dev 自动编译
-> F5 打开 Extension Development Host
-> 验证效果
-> npm run compile / npm run check-types
-> 打包 VSIX
-> 隔离环境安装测试
```
