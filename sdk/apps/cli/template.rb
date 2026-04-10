module GitHubHelper
  def self.get_asset_api_url(tag, pattern)
    require "utils/github"
    release = GitHub.get_release("cline", "sdk-wip", tag)
    
    asset = release["assets"].find { |asset| 
      asset["name"].include?(pattern)
    }
    
    if asset
      puts "Found asset: #{asset['name']} matching pattern: #{pattern}"
      asset["url"]
    else
      available_assets = release["assets"].map { |a| a["name"] }
      raise "No asset found matching pattern '#{pattern}'. Available: #{available_assets.join(', ')}"
    end
  end

  def self.token
    require "utils/github"
    github_token = ENV["HOMEBREW_GITHUB_API_TOKEN"]
    unless github_token
      github_token = GitHub::API.credentials
      raise "Failed to retrieve token" if github_token.nil? || github_token.empty?
    end
    github_token
  end
end



cask "cline" do
  desc "Cline CLI"
  homepage "https://github.com/cline/sdk-wip"
  version "__CLI_VERSION__"
  binary "cline", target: "clite"

  postflight do
    # Strip Gatekeeper quarantine flag so unsigned binaries run without
    # the "damaged and can't be opened" error on macOS.
    system_command "/usr/bin/xattr",
      args: ["-dr", "com.apple.quarantine", "#{staged_path}/cline"]
  end

  on_macos do
    on_arm do
      url "#{GitHubHelper.get_asset_api_url("v#{version}", "darwin-arm64")}",
        header: [
          "Accept: application/octet-stream",
          "Authorization: Bearer #{GitHubHelper.token}",
          "X-GitHub-Api-Version: 2022-11-28",
        ]
      sha256 "__CLI_MAC_ARM_SHA256__"
    end
    on_intel do
      url "#{GitHubHelper.get_asset_api_url("v#{version}", "darwin-x64")}",
        header: [
          "Accept: application/octet-stream",
          "Authorization: Bearer #{GitHubHelper.token}",
          "X-GitHub-Api-Version: 2022-11-28",
        ]
      sha256 "__CLI_MAC_INTEL_SHA256__"
    end
  end
  
  on_linux do
    on_intel do
      url "#{GitHubHelper.get_asset_api_url("v#{version}", "linux-x64")}",
        header: [
          "Accept: application/octet-stream",
          "Authorization: Bearer #{GitHubHelper.token}",
          "X-GitHub-Api-Version: 2022-11-28",
        ]
      sha256 "__CLI_LINUX_SHA256__"
    end
    on_arm do
      url "#{GitHubHelper.get_asset_api_url("v#{version}", "linux-arm64")}",
        header: [
          "Accept: application/octet-stream",
          "Authorization: Bearer #{GitHubHelper.token}",
          "X-GitHub-Api-Version: 2022-11-28",
        ]
      sha256 "__CLI_LINUX_ARM_SHA256__"
    end
  end
end

