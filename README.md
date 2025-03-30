# Cline-cn (盛世中华版本) 🌏

> 🎉 截止到2025.03.31，Cline-cn 在VS Code插件市场的下载量突破1啦！

<p align="center">

[![Version](https://marketplace.visualstudio.com/items?itemName=617694668.cline-cn)]

</p>

## 项目地址
https://github.com/dxdw2021/cline
欢迎大家star，fork，提出issue，贡献代码，一起完善这个项目。

## 文档地址(包括使用方法，MCP知识，常见问题解答等)
https://hybridtalentcomputing.gitbook.io/cline-chinese-doc/

## 功能展示

<video width="100%" controls src="https://github.com/dxdw2021/cline/edit/main/User%20Tutorials/%E4%B8%AD%E5%9B%BD%E7%89%88%E6%9C%AC.mp4"></video>
> 演示视频使用 DeepSeek-R1-Distill-Qwen-14B 模型，展示了 Cline 中文汉化版的主要功能和使用效果，视频没有加速，推理速度快到飞起。

> 日常开发时，我使用的是某基某动的白嫖额度的模型API，如果您尚未注册，欢迎通过我的邀请链接：https://cloud.siliconflow.cn/i/HUTeVyQ9，或者注册的时候填写邀请码：HUTeVyQ9，注册后双方均可获得2000万tokens的免费额度。

## 安装使用
Cline-Chinese已发布到VSCode插件市场，欢迎感兴趣的小伙伴们下载体验。

## 简介

这个项目是基于 [Cline](https://github.com/cline/cline) 的汉化版本。旨在优化由于英文 prompt 导致 Cline 在中文输入下+国产大模型（如：deepseek）表现不佳的问题, 并提供更符合中文用户习惯的UI界面和功能。目前已测试[DeepSeek-R1/DeepSeek-V3](https://github.com/deepseek-ai/DeepSeek-R1)工作良好。

日常使用cline等编程助手时发现使用某些模型推理速度较慢（如deepseek-R1, Claude-3.5-Sonnet），这个项目优先尝试在中文输入下，对轻量化LLM进行实验（如Deepseek-R1-Distill-Qwen-7B/14B），优化中文prompt, 以提升推理速度，大大减少等待的时间。

> **🚀 重要提示：经过测试，3.4.10版本下，DeepSeek-R1-Distill-Qwen-14B 模型工作良好，推理速度极快，强烈推荐尝试！**

## 背景

本人是一名AI从业者+爱好者，在使用Cline时，发现Cline的UI界面和提示词均为英文，使用中文输入时，有时会出现奇奇怪怪的输出，影响体验。因此，决定自己动手，汉化Cline。
另外，秉着学习的态度，未来将着手修改Cline的核心代码，增加新的功能，以提升体验。

## 版本说明

## 2024.03.30 [3.8.4]
-   2025年3月30日 - 发布 中华人民共和国中文版本 3.8.4
-   添加 Sambanova Deepseek-V3-0324
-   为 LiteLLM provider 添加成本计算支持
-   修复 Cline 在没有 response 参数时使用 plan_mode_response 的错误


## 加入社群

感兴趣的可以扫码加入微信社群，一起交流学习AI：

<div align="center">
  <img src="https://github.com/user-attachments/assets/afc4e7e5-8b88-4c31-942c-a248dd81e00d" alt="微信群二维码" width="250" />
</div>

## 赞赏支持

如果您觉得这个项目对您有帮助，欢迎赞赏支持，您的支持是我持续开发的动力 ☕

<div align="center" style="display: flex; justify-content: center; gap: 20px;">

  <img src="https://github.com/user-attachments/assets/f01e4514-e8ec-48de-883a-9f6fbd05c2a0" alt="支付宝赞赏" width="250" />
  <img src="https://raw.githubusercontent.com/dxdw2021/cline/main/User%20Tutorials/png/weixin-%E8%B5%9E%E8%B5%8F%E7%A0%81.png" alt="微信赞赏" width="250" />

</div>

## 免责声明

1. **使用风险**：本项目是一个开源的VSCode插件，用户在使用过程中可能会遇到的任何问题或风险，开发者不承担任何责任。

2. **数据安全**：本插件不会收集或存储任何用户数据。但在使用过程中，用户应注意保护自己的敏感信息和代码安全。

3. **知识产权**：
   - 本项目是基于Cline的汉化版本，原版权归属于Cline团队。
   - 汉化部分的内容采用与原版Cline相同的Apache-2.0许可证。
   - 用户在使用过程中应遵守相关的开源协议。

4. **免责声明**：
   - 本项目不提供任何明示或暗示的保证，包括但不限于适销性和特定用途适用性的保证。
   - 开发者不对任何直接或间接损失负责，包括但不限于利润损失、数据丢失等。
   - 用户使用本插件即表示同意承担使用过程中的所有风险。

5. **更新和维护**：
   - 开发者将努力维护本项目，但不保证及时更新或修复所有问题。
   - 本项目可能随时变更或终止，会及时同步到本项目中。
---

> 注：Cline中文版本本项目是个人维护的汉化版本，与原版 Cline 团队无关。如果您喜欢这个项目，也请给原版 [Cline](https://github.com/cline/cline) 一个 star ⭐️

