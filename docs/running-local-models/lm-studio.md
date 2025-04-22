---
description: A quick guide to setting up LM Studio for local AI model execution with Cline.
---

# LM Studio

## 🤖 Setting Up LM Studio with Cline

Run AI models locally using LM Studio with Cline.

### 📋 Prerequisites

* Windows, macOS, or Linux computer with AVX2 support
* Cline installed in VS Code

### 🚀 Setup Steps

#### 1. Install LM Studio

* Visit [lmstudio.ai](https://lmstudio.ai)
* Download and install for your operating system

<figure><img src="../.gitbook/assets/image (7).png" alt=""><figcaption></figcaption></figure>

#### 2. Launch LM Studio

* Open the installed application
* You'll see four tabs on the left: **Chat**, **Developer** (where you will start the server), **My Models** (where your downloaded models are stored), **Discover** (add new models)

<figure><img src="../.gitbook/assets/image (10).png" alt=""><figcaption></figcaption></figure>

#### 3. Download a Model

* Browse the "Discover" page
* Select and download your preferred model
* Wait for download to complete

<figure><img src="../.gitbook/assets/lm-studio-download-model.gif" alt=""><figcaption></figcaption></figure>

#### 4. Start the Server

* Navigate to the "Developer" tab
* Toggle the server switch to "Running"
* Note: The server will run at `http://localhost:1234`

<figure><img src="../.gitbook/assets/lm-studio-starting-server.gif" alt=""><figcaption></figcaption></figure>

#### 5. Configure Cline

1. Open VS Code
2. Click Cline settings icon
3. Select "LM Studio" as API provider
4. Select your model from the available options

<figure><img src="../.gitbook/assets/lm-studio-select-model-cline.gif" alt=""><figcaption></figcaption></figure>



### ⚠️ Important Notes

* Start LM Studio before using with Cline
* Keep LM Studio running in background
* First model download may take several minutes depending on size
* Models are stored locally after download

### 🔧 Troubleshooting

1. If Cline can't connect to LM Studio:
2. Verify LM Studio server is running (check Developer tab)
3. Ensure a model is loaded
4. Check your system meets hardware requirements
