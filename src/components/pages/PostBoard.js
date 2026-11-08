import React, { lazy, Suspense, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClipboard } from '@fortawesome/free-solid-svg-icons'; // Add faClipboard
import AITools from './AITools';
import "../../styles/PostBoard.css";

// three.js is only needed for this tab, so keep it out of the page bundle.
const CoolAnimation = lazy(() => import('./CoolAnimation'));

const GUIDE_TABS = [
  { id: 'edgegap', value: 'Edgegap vs GameLift', label: 'Edgegap vs GameLift' },
  { id: 'gamelift', value: 'AWS GameLift Guide', label: 'GameLift · older UE guide' },
  { id: 'ai-tools', value: 'AI Tools', label: 'AI Tools' },
  { id: 'animation', value: '3D Cool Animations', label: '3D Animation' },
];

const INSTALLBAT = () => `
  @echo off
  set "PREREQ=%~dp0Engine\\Extras\\Redist\\en-us\\UEPrereqSetup_x64.exe"
  set "LOG_FILE=%~dp0UEPrereqSetup_x64.log"

  if not exist "%PREREQ%" (
      echo Unreal Engine prerequisites were not found at "%PREREQ%".
      echo Update this path to match the packaged server build.
      exit /b 1
  )

  REM Install Unreal Engine prerequisites
  echo Installing Unreal Engine prerequisites...
  start /wait "" "%PREREQ%" /install /quiet /norestart /log "%LOG_FILE%"
  if errorlevel 1 (
      echo Failed to install Unreal Engine prerequisites. Check log: %LOG_FILE%
      exit /b 1
  )

  REM This script installs prerequisites only. Configure the server executable in GameLift runtime settings.
  echo Installation completed successfully.
  exit /b
`;

const UPLOADBUILDCOMMAND = () => `
aws gamelift upload-build --name "<build-name>" --operating-system "<supported-os>" --build-root "C:/path/to/WindowsServer" --build-version "<build-version>" --region "<aws-region>" --server-sdk-version "<matching-server-sdk-version>" --profile "<aws-profile>"
`;


const OPENSSL_SETUP = () => `
$env:OPENSSL_ROOT_DIR = 'C:\\Program Files\\OpenSSL-Win64'
$env:OPENSSL_INCLUDE_DIR = Join-Path $env:OPENSSL_ROOT_DIR 'include'
$env:OPENSSL_LIBRARIES = Join-Path $env:OPENSSL_ROOT_DIR 'lib'
$env:PATH = (Join-Path $env:OPENSSL_ROOT_DIR 'bin') + ';' + $env:PATH
`;

const PostBoard = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedImageSrc, setExpandedImageSrc] = useState('');
  const [selectedGuide, setSelectedGuide] = useState(GUIDE_TABS[0].value);

  const handleImageClick = (src) => {
    setExpandedImageSrc(src);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setExpandedImageSrc('');
  };

  const handleTabKeyDown = (event, index) => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % GUIDE_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + GUIDE_TABS.length) % GUIDE_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = GUIDE_TABS.length - 1;
    else return;

    event.preventDefault();
    setSelectedGuide(GUIDE_TABS[nextIndex].value);
    document.getElementById(`postboard-tab-${GUIDE_TABS[nextIndex].id}`)?.focus();
  };

  function copyToClipboard(commandText) {
    navigator.clipboard.writeText(commandText)
      .then(() => {
        alert("Command copied to clipboard!");
      })
      .catch((err) => {
        console.error("Failed to copy: ", err);
      });
  }


  const post0 = () => {
    return (
      <div className='guide-box'>
        <h1>Edgegap and Amazon GameLift: different hosting approaches</h1>
        <p>
          This is a high-level comparison, not a benchmark or a universal recommendation. The right choice depends on
          your server architecture, target regions, operations needs, and current pricing.
        </p>

        <h3>Different deployment models</h3>
        <p>
          Amazon GameLift Servers provides managed game-server hosting options, including managed EC2 fleets, and
          integrates with other AWS services. The amount of fleet, queue, and session management you own depends on
          which GameLift features you choose.
        </p>
        <p>
          Edgegap is centered on container-based orchestration and placement across its available locations. A game
          server still needs to be packaged for the platform and integrated with its allocation/session workflow.
          See <a href="https://edgegap.com/" target="_blank" rel="noreferrer">Edgegap’s current platform information</a>.
        </p>

        <h3>Tradeoffs to evaluate</h3>
        <ul className='steps text-left'>
          <li>
            <strong>Packaging:</strong>
            <p>Container-first deployment can fit teams already using Docker. GameLift’s managed EC2 workflow may fit a project that needs AWS fleet controls or existing AWS integration.</p>
          </li>
          <li>
            <strong>Latency:</strong>
            <p>Nearby placement does not guarantee lower player latency. Compare the actual regions available to your audience and measure p95 connection and session latency.</p>
          </li>
          <li>
            <strong>Operations:</strong>
            <p>Compare fleet/session setup, monitoring, logs, capacity behavior, deployment workflow, and the amount of platform-specific integration your team will maintain.</p>
          </li>
          <li>
            <strong>Cost and availability:</strong>
            <p>Model costs for your expected concurrency, idle capacity, traffic, and regions using each provider’s current pricing. Container portability does not remove provider-specific APIs or operational tradeoffs.</p>
          </li>
        </ul>

        <h3>Practical next step</h3>
        <p>
          Deploy the same small server prototype to both options, then compare setup effort, cold-start behavior,
          measured player latency, operational visibility, and total cost. Re-check current provider documentation
          before committing to a production design.
        </p>
      </div>
    )
  }


  const post1 = () => {
    return (
      <div className='guide-box'>

        <h1>Unreal Engine dedicated-server walkthrough</h1>
        <aside className="guide-notice" role="note">
          <strong>Legacy, version-specific guide.</strong> The download examples below reference GameLift Server SDK
          5.2.0 and plugin 2.0.1. They have not been verified against current AWS releases. Check the current AWS
          Unreal integration guide and supported versions before following these steps; do not treat this as a
          current, tested deployment recipe.
        </aside>
        <p>
          This page records an older Windows/Unreal workflow for building a dedicated server and connecting it to
          Amazon GameLift Servers. Plugin APIs, Unreal packaging steps, supported operating systems, and SDK versions
          change; use the linked AWS documentation as the source of truth.
        </p>

        <h5>Reference Links</h5>
        <a href="https://github.com/aws/amazon-gamelift-plugin-unreal/blob/main/README.md" target="_blank" rel="noreferrer">Official GameLift Unreal Plugin README</a><br />
        <a href="https://docs.aws.amazon.com/gamelift/latest/developerguide/integration-engines-setup-unreal.html" target="_blank" rel="noreferrer">AWS GameLift Unreal Engine Integration Guide</a><br />
        <a href="https://www.youtube.com/watch?v=HzffxtyyIOA" target="_blank" rel="noreferrer">Third-party YouTube walkthrough (check its date/version)</a><br />
        <p>
          In the following sections, I'll cover step-by-step instructions, common pitfalls, and solutions to issues you might encounter while setting up GameLift with Unreal Engine.
          Let's dive in! 🚀
        </p>
        <div className='steps text-left'>
          <ul>
            <li><h2>Step 1:</h2> Download Unreal Engine source code and Visual Studio <br />
              <p>There’s no workaround for this. I tried installing from Epic Games and skipping this step and ran into a "this version of Unreal doesn’t support server build".
                So first, install Visual Studio 2022 and the necessary game development components for Unreal Engine development, Visual Studio tools, Windows 10 SDK, etc...&nbsp;
                <a href="https://visualstudio.microsoft.com/downloads/" target="_blank" rel="noreferrer">Visual Studio 2022</a></p>

               <button type="button" className="image-container" aria-label="Enlarge Visual Studio components screenshot" onClick={() => handleImageClick("https://s3.us-east-1.amazonaws.com/reimondev.com/vs2022components.JPG")}>
                <img src="https://s3.us-east-1.amazonaws.com/reimondev.com/vs2022components.JPG" alt="Visual Studio 2022 components required for an Unreal Engine source build" />
              </button>
              <br />
              <p>Download Unreal Engine source code from GitHub:
                <a href="https://github.com/EpicGames/UnrealEngine.git" target="_blank" rel="noreferrer"> Unreal Engine GitHub </a>
                or download the zip and extract it:
                <a href="https://github.com/EpicGames/UnrealEngine/archive/refs/heads/release.zip" target="_blank" rel="noreferrer"> Unreal Engine GitHub zip </a>.
                Otherwise you can use the command line to clone the repository:
              </p>
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard("git clone https://github.com/EpicGames/UnrealEngine.git")}
                  /> git clone https://github.com/EpicGames/UnrealEngine.git
                </p>
              </div>

              <p>After cloning the repository, run the setup.bat file in the root directory. This will download the necessary files and dependencies.</p>
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(".\\Setup.bat")}
                  /> .\Setup.bat
                </p>
              </div>
              <p>After the setup is complete, run the GenerateProjectFiles.bat file.</p>
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(".\\GenerateProjectFiles.bat")}
                  /> .\GenerateProjectFiles.bat
                </p>
              </div>
              <p>For this legacy Windows dedicated-server route, build the source engine version required by your project and GameLift plugin. Verify the current Unreal Engine instructions before starting; editor builds and server builds use different targets.</p>
              <p><b>NOTE:</b> A source build needs substantial disk space and can take a long time. The exact requirement depends on engine version and configuration; use current Unreal documentation rather than treating the old 300 GB estimate as a guarantee.</p>

              <button type="button" className="image-container" aria-label="Enlarge Unreal Engine source build screenshot" onClick={() => handleImageClick("https://s3.us-east-1.amazonaws.com/reimondev.com/unrealbuild.JPG")}>
                <img src="https://s3.us-east-1.amazonaws.com/reimondev.com/unrealbuild.JPG" alt="Unreal Engine source build in Visual Studio" />
              </button>
              <br></br>
              Neat! Now you can run and modify your custom Unreal Engine build from source code. However, don’t change anything yet, because modifying the source code will trigger a rebuild of the engine.            <br></br>

            </li>

            <li><h2>Step 2:</h2> Choose compatible GameLift plugin and Server SDK versions.<br />
              <p>
                The links in this legacy walkthrough are pinned to older releases. Verify compatibility with your
                Unreal Engine version in the current AWS documentation before downloading; do not assume that a
                repository's main branch and an older prebuilt SDK package can be mixed.
              </p>

              <p><i>NOTE:</i> Follow the selected release's README and installation instructions. Avoid combining plugin and SDK files from different releases.</p>

              <p>Choose a supported plugin/SDK combination and follow its release-specific README:</p>
              <ul>
                <li><strong>Plugin source:</strong> <a href="https://github.com/aws/amazon-gamelift-plugin-unreal" target="_blank" rel="noreferrer">Amazon GameLift plugin for Unreal</a>.</li>
                <li><strong>Legacy Unreal Server SDK plugin package (5.2.0):</strong> <a href="https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/unreal/GameLift-Cpp-ServerSDK-UnrealPlugin-5.2.0.zip" target="_blank" rel="noreferrer">download package</a>.</li>
                <li><strong>Legacy C++ Server SDK package (5.2.0):</strong> <a href="https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/cpp/GameLift-Cpp-ServerSDK-5.2.0.zip" target="_blank" rel="noreferrer">download package</a>.</li>
              </ul>
              <p>These packages have different contents; one is not a substitute for the other.</p>
              <p>Start with the <a href="https://aws.amazon.com/gamelift/servers/getting-started/" target="_blank" rel="noreferrer">official AWS GameLift getting-started guide</a> and confirm the current release before using any pinned download below.</p>
              <p><strong>NOTE:</strong> Follow the selected package’s install layout. Keep paths short on Windows if your toolchain hits path-length limits.</p>
              <p>An older bundled release is also available at <a href="https://github.com/aws/amazon-gamelift-plugin-unreal/releases/download/v2.0.1/amazon-gamelift-plugin-unreal-release-2.0.1.zip" target="_blank" rel="noreferrer">plugin release 2.0.1</a>; check its release notes and compatibility before using it.</p>
              <p>For the pinned legacy example, follow the matching <strong>GameLift-Cpp-ServerSDK-5.2.0</strong> README. The remaining build steps are Windows-specific.</p>
              <p>Make sure you have all the required tools installed, including CMake, OpenSSL, and Python, before starting the Unreal SDK plugin packaging process.</p>


              <h3>Configuring CMake</h3>
              <p>
                Use the Visual Studio installation path and set all the necessary environment variables:
              </p>

              <h4>Environment Variables</h4>
              <pre>
                <strong>PATH</strong>
                C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin
                C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin
              </pre>

              <p>
                Once installed, navigate to the OpenSSL folder (for example: <code>C:\Program Files\OpenSSL-Win64</code>).<br></br>
                If the SDK is dynamically linked, the runtime DLLs may need to ship with the server. Confirm dependencies for your build configuration.
              </p>
              <li><code>libssl-3-x64.dll</code></li>
              <li><code>libcrypto-3-x64.dll</code></li>
              <p>
                Do not copy DLLs blindly; inspect the built server’s runtime dependencies and package only what it requires.
              </p>
              <p>Open PowerShell in the same terminal session you will use for CMake, update the OpenSSL path, and run this snippet. It changes only the current session.</p>
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(OPENSSL_SETUP())}
                  /> {OPENSSL_SETUP()}
                </p>
              </div>
              <p>These values are temporary to this terminal session. Avoid changing machine-wide environment variables for this build.</p>
              <p>Install Python if required by the selected SDK release’s build instructions:</p>
              <p>
                <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">Download Python</a>
              </p>
              These variables are set for the current terminal only. Continue with the matching SDK README; outputs and required dependencies vary by release and build configuration.
            </li>


            <li>
              <h2>Step 3:</h2>
              <p>Build the C++ SDK for Windows to generate .dll and .lib plugin files.</p>
              <p>
                You can follow the instructions in the README file to build the SDK for Linux,
                but here, I will only cover the steps for building the SDK on Windows.
              </p>
              <p>
                In the command prompt, navigate to the downloaded SDK source code directory
                (e.g., <code>C:\GameLiftServerSdkCpp</code>) and create the build directory using the following command:
              </p>

              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon
                    className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(`mkdir cmake-build`)}
                  />
                  <code> mkdir cmake-build</code>
                </p>
              </div>


              <p>Make the solution and project files.</p>
              <p>
                <strong>NOTE:</strong> Here's where it gets specific, as different flags are needed for different builds.
              </p>
               <button type="button" className="image-container" aria-label="Enlarge GameLift CMake configuration screenshot" onClick={() => handleImageClick("https://s3.us-east-1.amazonaws.com/reimondev.com/buildconfigurations.JPG")}>
                <img src="https://s3.us-east-1.amazonaws.com/reimondev.com/buildconfigurations.JPG" alt="CMake configuration options for building the GameLift C++ Server SDK" />
              </button><br></br>
              <strong>Unreal Engine:</strong> To use GameLift with Unreal Engine, set <code>BUILD_FOR_UNREAL=1</code> and <code>BUILD_SHARED_LIBS=0</code> to create a single, self-contained library.<br></br>
              <strong>Standard C++ Projects (Non-Unreal):</strong> For standard C++ projects (not Unreal Engine), set <code>GAMELIFT_USE_STD=1</code> to use the standard C++ library.<br></br>
              <strong>Dynamic Linking:</strong> To use dynamic linking with shared libraries, set <code>BUILD_SHARED_LIBS=1</code>.<br></br>
              <p> For this scenario, we are using Unreal Engine, so use the following command:</p>
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon
                    className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(`cmake -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release -DBUILD_FOR_UNREAL=1 -DBUILD_SHARED_LIBS=0 -DOPENSSL_ROOT_DIR="$env:OPENSSL_ROOT_DIR" -S . -B ./cmake-build`)}
                  />
                  <code> cmake -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release -DBUILD_FOR_UNREAL=1 -DBUILD_SHARED_LIBS=0 -DOPENSSL_ROOT_DIR="$env:OPENSSL_ROOT_DIR" -S . -B ./cmake-build</code>
                </p>
              </div>
              <p>Compile the solution for release.</p>
              <strong>NOTE:</strong> remeber to have it in the root directory like C:/ to avoid path too long errors.
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon
                    className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(`cmake --build ./cmake-build --target ALL_BUILD --config Release`)}
                  />
                  <code> cmake --build ./cmake-build --target ALL_BUILD --config Release</code>
                </p>
              </div>

              <p>Once the build is complete, locate the generated files using the SDK README. The following copy path applies only to the pinned legacy plugin package; other releases may use a different layout.</p>
              <p>-Navigate to <b>C:\GameLift-Cpp-ServerSDK-5.2.0\cmake-build\prefix</b>.</p>
              <p>-Inside the <b>lib</b> folder, copy the <b>aws-cpp-sdk-gamelift-server.lib</b> file to a temporary directory.</p>
              <p>-Then Inside the <b>bin</b>, copy the <b>aws-cpp-sdk-gamelift-server.dll</b> file to the same temporary directory.</p>
              <p>-After that, copy both the <b>aws-cpp-sdk-gamelift-server.lib</b> and <b>aws-cpp-sdk-gamelift-server.dll</b> files to the following directory:
                <b><br />\amazon-gamelift-plugin-unreal\GameLiftPlugin\Source\GameLiftServer\ThirdParty\GameLiftServerSDK\Win64</b>
              </p>
              <p>Ensure both files are correctly copied. You should also find a <code>readme</code> file in that folder.</p>

              <p><b>NOTE:</b> This works only in a C++ multiplayer game project with game code. Projects that use Blueprints only are not compatible with this plugin at this time.</p>

              <p>Follow the selected plugin release’s README to install and enable it. The folder layout and <code>.uproject</code> plugin entry vary by release; this walkthrough does not provide a universal plugin configuration.</p>

              <p>
                Navigate to the source code and locate the <b>Editor.Target.cs</b> file. Make a copy of it and rename the copy to <b>Server.Target.cs</b>.
                Open the file in a text editor. Replace "Editor" with "Server" in the class name, and do the same for the constructor.
                For <code>TargetType.Editor</code>, change it to <code>TargetType.Server</code>.
                Save the changes and close the file. This will enable the option to build the server version of the game.
              </p>

              <p>Ensure you have the correct path and place the files inside the <code>Win64</code> directory. Then, rebuild the solution in Visual Studio. Right-click on the <code>.uproject</code> file and select "Edit."</p>
              <p><b>NOTE:</b> This plugin is compatible only with a C++ multiplayer game project with game code. Projects that use Blueprints only are not compatible with this plugin at this time.</p>
            </li>

            <li>
              <h2>Step 4: Add GameLift Code to the Visual Studio Project</h2>
              <p>
                Add Amazon GameLift Servers server code to your Unreal project. Refer to the
                <a href="https://docs.aws.amazon.com/gamelift/latest/developerguide/integration-engines-setup-unreal.html" target="_blank" rel="noreferrer">official AWS documentation</a> for more details.
              </p>

              <p><strong>Version note:</strong> The code below is illustrative and follows the older Server SDK API. Match the headers, callback types, and process configuration to the SDK version you actually installed.</p>
              <p><strong>Before using the sample:</strong> add your game’s session-start logic before activating the session, make the health check reflect real server readiness, call <code>ProcessEnding</code> and shut down cleanly on termination, and match the port/log path to your project and fleet configuration.</p>

              <h3>1. Add GameLift Dependency in Build.cs</h3>
              <p>Launch your Unreal Engine project using Visual Studio and navigate to the source folder for the game module.</p>
              <p>Open the relevant module <b>.Build.cs</b> file (not the Target.cs file) and add the dependency required by your installed GameLift plugin version:</p>
              <div className="command-container">
                <p className="command">
                  <pre>
                    <code>
                      {`using UnrealBuildTool;
using System.Collections.Generic;

public class GameLiftUnrealApp : ModuleRules  
{
    public GameLiftUnrealApp(TargetInfo Target)
    {
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "GameLiftServerSDK" });
        bEnableExceptions = true;
    }
}`}
                    </code>
                  </pre>
                </p>
              </div>
              <h3>2. Integrate Game Server with GameLift Modify GameMode Header File</h3>
              <p>Modify GameMode Header File, Edit the <b>Your-application-nameGameMode.h</b> file (e.g., <b>GameLiftUnrealAppGameMode.h</b>):</p>
              <div className="command-container">
                <p className="command">
                  <pre>
                    <code>
                      {`#pragma once

#include "CoreMinimal.h"

#include "GameFramework/GameModeBase.h"
#include "GameLiftServerSDK.h"
#include "GameLiftUnrealAppGameMode.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(GameServerLog, Log, All);

UCLASS(minimalapi)
class AGameLiftUnrealAppGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AGameLiftUnrealAppGameMode();

protected:
    virtual void BeginPlay() override;

private:
    FProcessParameters m_params;
    void InitGameLift();
};
`}
                    </code>
                  </pre>
                </p>
              </div>

              <h3>3. Modify GameMode Source File</h3>
              <p><b>NOTE:</b> It is very important that your server level uses this game mode as the default one; otherwise, it won’t call <code>INITSDK()</code> in <code>BeginPlay()</code>.</p>
              <p>Edit <b>Your-application-nameGameMode.cpp</b> (e.g., <b>GameLiftUnrealAppGameMode.cpp</b>) and ensure it follows this structure:</p>

              <div className="command-container">
                <p className="command">
                  <pre>
                    <code>
                      {`// Fill out your copyright notice in the Description page of Project Settings.

#include "GameLiftUnrealAppGameMode.h"
#include "GameLiftUnrealAppCharacter.h"
#include "UObject/ConstructorHelpers.h"
#include "aws/gamelift/server/GameLiftServerAPI.h"

#define GAMELIFT_USE_STD 0

using namespace Aws::GameLift::Server;

DEFINE_LOG_CATEGORY(GameServerLog);

AGameLiftUnrealAppGameMode::AGameLiftUnrealAppGameMode()
{
    // Set default pawn class to our Blueprinted character
    DefaultPawnClass = AGameLiftUnrealAppCharacter::StaticClass();
}

void AGameLiftUnrealAppGameMode::BeginPlay()
{
    Super::BeginPlay();

#if WITH_GAMELIFT
    InitGameLift();
#endif
}

void AGameLiftUnrealAppGameMode::InitGameLift()
{
    UE_LOG(GameServerLog, Log, TEXT("Initializing the GameLift Server"));

    // Load the GameLift Server SDK module
    FGameLiftServerSDKModule* gameLiftSdkModule = &FModuleManager::LoadModuleChecked<FGameLiftServerSDKModule>(FName("GameLiftServerSDK"));

    // Initialize GameLift SDK (for Managed EC2 Fleets, call InitSDK without parameters)
    gameLiftSdkModule->InitSDK();

    UE_LOG(GameServerLog, Log, TEXT("GameLift SDK Initialized Successfully."));

    // Callback: Handle Game Session Activation
    auto onGameSession = [=](Aws::GameLift::Server::Model::GameSession gameSession)
        {
            FString gameSessionId = FString(gameSession.GetGameSessionId());
            UE_LOG(GameServerLog, Log, TEXT("GameSession Initializing: %s"), *gameSessionId);
            gameLiftSdkModule->ActivateGameSession();
        };
    m_params.OnStartGameSession.BindLambda(onGameSession);

    // Callback: Handle Process Termination
    auto onProcessTerminate = [=]()
        {
            UE_LOG(GameServerLog, Log, TEXT("Game Server Process is terminating"));
            gameLiftSdkModule->ProcessEnding();
        };
    m_params.OnTerminate.BindLambda(onProcessTerminate);

    // Callback: report whether this server process is healthy.
    auto onHealthCheck = []() -> bool
        {
            UE_LOG(GameServerLog, Log, TEXT("Performing Health Check"));
            return true;
        };
    m_params.OnHealthCheck.BindLambda(onHealthCheck);

    // Configure server settings
    m_params.port = 7777;  // Example only: match the port your server actually listens on.

    // Define log file locations (GameLift will upload these for debugging)
    m_params.logParameters = { TEXT("YourProject/Saved/Logs/GameServer.log") };  // Replace with a real path in your package.

    // Notify GameLift that the process is ready to host game sessions
    UE_LOG(GameServerLog, Log, TEXT("Calling Process Ready"));
    gameLiftSdkModule->ProcessReady(m_params);
}
`}
                    </code>
                  </pre>
                </p>
              </div>
              <p>Remove unnecesary code to set up a Managed EC2 Fleet instead of a GameLift Anywhere Fleet, these changes are removed from original code:</p>
              <p><strong>Change InitSDK Call</strong>: Replace <code>{`gameLiftSdkModule->InitSDK(serverParameters);`}</code> with <code>gameLiftSdkModule->InitSDK();</code></p>
              <strong>Remove GameLift Anywhere-specific parameters</strong>:
              <p>Auth Token (<code>m_authToken</code>)</p>
              <p>AWS Region (<code>m_awsRegion</code>)</p>
              <p>Access Key (<code>m_accessKey</code>)</p>
              <p>Secret Key (<code>m_secretKey</code>)</p>
              <p>Session Token (<code>m_sessionToken</code>)</p>
              <p>Host ID (<code>m_hostId</code>)</p>
              <p>WebSocket URL (<code>m_webSocketUrl</code>)</p>
              <p>Fleet ID (<code>m_fleetId</code>)</p>

              <p>Following these steps, your Unreal project should be properly configured to use Amazon GameLift.</p>
            </li>

            <li>
              <h2>Step 5:</h2> Build Package for Windows Server
              <p>Open your Unreal Engine project.</p>
              <p>In the toolbar, click on <strong>"Edit"</strong> and then select <strong>"Plugins"</strong>. Verify that the GameLift plugin is enabled.</p>
              <p>Next, go to <strong>"Project Settings"</strong> and select <strong>"Maps & Modes"</strong>.</p>
              <p>Set the default map for both the client and server levels.</p>
              <p>Go to the <strong>"File"</strong> menu and select <strong>"Package Project"</strong>, then choose <strong>"Windows"</strong> and select <strong>"Windows Server"</strong>.</p>
              <p>Wait for the build to complete; this may take some time depending on your project size.</p>

              <p>
                Once the build is complete, you will have a server target build and an output directory labeled <code>"WindowsServer"</code>.
                Next, add the necessary files. In the root directory of your Windows server build, create a new <code>install.bat</code> file and insert the following lines:
              </p>

              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon
                    className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(INSTALLBAT())}
                  />
                  {INSTALLBAT()}
                </p>
              </div>

              <p>
                Add the required OpenSSL .dll files. <strong>COPY</strong> the following two DLLs and save them to a safe location for later use (such as your desktop):
              </p>

              <ul>
                <li><code>libssl-3-x64.dll</code></li>
                <li><code>libcrypto-3-x64.dll</code></li>
              </ul>

              <p>
                <strong>These two DLLs must be included in your game server build when you upload it to Amazon GameLift.</strong>
              </p>
            </li>




            <li>
              <h2>Step 6: Upload the build with temporary AWS credentials</h2>
              <p>
                Do not create an IAM user with long-lived access keys or attach wildcard <code>gamelift:*</code>
                permissions for this walkthrough. Use your organization’s approved IAM Identity Center profile or
                assumed role, and grant only the actions required by the current <code>upload-build</code> workflow.
              </p>
              <p>Sign in with your configured profile and confirm which AWS account it targets:</p>
              <pre><code>{`aws sso login --profile my-profile\naws sts get-caller-identity --profile my-profile`}</code></pre>

              <p>
                Replace every placeholder in this example. The operating-system and Server SDK values must be
                supported by the current GameLift Servers documentation and match the packaged server build.
              </p>
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon
                    className="clipboard"
                    icon={faClipboard}
                    onClick={() => copyToClipboard(UPLOADBUILDCOMMAND())}
                  /> <code>{UPLOADBUILDCOMMAND()}</code>
                </p>
              </div>



            </li>
            <li>
              <h2>Step 7: Configure a fleet and test connectivity</h2>
              <p>
                Create the fleet type supported by your design and select the uploaded build. Configure the server
                runtime executable, process settings, ports, and health checks to match your packaged server. Do not
                assume a fixed executable path, port, or open-to-the-world CIDR; use the values your game requires and
                current AWS security guidance.
              </p>
              <p>
                Before inviting players, verify that the process becomes healthy, sessions start and end cleanly, the
                client connects through the assigned connection information, and logs are available for diagnosis.
                Fleet creation and billing details vary by fleet type, so confirm them in the current AWS documentation.
              </p>
            </li>

          </ul>
        </div>
      </div>
    );
  }

  return (
    <main className="PostBoard">
      <header className="postboard-heading">
        <p className="postboard-eyebrow">NOTES & RESOURCES</p>
        <h1>Postboard</h1>
      </header>

      <nav className="postboard-tabs" role="tablist" aria-label="Postboard topics">
        {GUIDE_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`postboard-tab-${tab.id}`}
            className={`postboard-tab${selectedGuide === tab.value ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={selectedGuide === tab.value}
            aria-controls="postboard-panel"
            tabIndex={selectedGuide === tab.value ? 0 : -1}
            onClick={() => setSelectedGuide(tab.value)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section
        className="container postboard-panel"
        id="postboard-panel"
        role="tabpanel"
        aria-labelledby={`postboard-tab-${GUIDE_TABS.find((tab) => tab.value === selectedGuide)?.id}`}
        tabIndex={0}
      >
        <div className="postboard-content">
          {selectedGuide === 'Edgegap vs GameLift' && post0()}
          {selectedGuide === 'AWS GameLift Guide' && post1()}
          {selectedGuide === 'AI Tools' && <AITools />}
          {selectedGuide === '3D Cool Animations' && (
            <Suspense fallback={<div className="page-loading" role="status">Loading animation…</div>}>
              <CoolAnimation />
            </Suspense>
          )}
        </div>
      </section>

      {isModalOpen && (
        <div className="modal" onClick={handleModalClose}>
          <img src={expandedImageSrc} alt="Expanded" />
        </div>
      )}
    </main>
  );
}

export default PostBoard;
