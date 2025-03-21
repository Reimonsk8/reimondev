import React, { useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faBrain,
  faSearch,
  faGem,
  faCommentDots,
} from '@fortawesome/free-solid-svg-icons';
import { faXTwitter } from '@fortawesome/free-brands-svg-icons'; // Correct import
import { faClipboard } from '@fortawesome/free-solid-svg-icons'; // Add faClipboard
import AITools from './AITools';
import CoolAnimation from './CoolAnimation';
import "../../styles/PostBoard.css";

const INSTALLBAT = () => `
  @echo off
  set INSTALL_DIR=C:\\game
  set LOG_FILE=%INSTALL_DIR%\\UEPrereqSetup_x64.log
  set SERVER_EXE=%INSTALL_DIR%\\UnknownVoidOnline\\Binaries\\Win64\\UnknownVoidOnlineServer.exe

  REM Create installation directory if it doesn't exist
  if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

  REM Install Unreal Engine prerequisites
  echo Installing Unreal Engine prerequisites...
  start /wait Engine\\Extras\\Redist\\en-us\\UEPrereqSetup_x64.exe /install /quiet /norestart /log "%LOG_FILE%"
  if %errorLevel% neq 0 (
      echo Failed to install Unreal Engine prerequisites. Check log: %LOG_FILE%
      exit /b
  )

  echo Installation completed successfully.
  exit /b
`;

const UPLOADSERVERBAT = () => `
aws gamelift upload-build --name "{yourgamename}" --operating-system "WINDOWS_2016" --build-root "C:\Users\{yourusername}\Documents\Unreal Projects\{yourgamename}\WindowsServer" --build-version "1.0.0" --region {yourregion ex: us-west-1} --server-sdk-version 5.2.0
`;


const UPROJECTPLUGINCONFIGURATION = () => `
  "Plugins": [
    { "Name": "WebBrowserWidget", "Enabled": true },
    { "Name": "HttpBlueprint", "Enabled": true }
  ]
`;


const SETOPENSSLPATHSBAT = () => `
@echo off
setlocal EnableDelayedExpansion

:: Set your OpenSSL installation path here
set "OPENSSL_DIR=C:\\Program Files\\OpenSSL-Win64"

:: Check if the path exists
if not exist "%OPENSSL_DIR%" (
    echo Error: The specified path does not exist. Please check the OPENSSL_DIR variable.
    exit /b
)

:: Set environment variables
setx OPENSSL_INCLUDE_DIR "%OPENSSL_DIR%\\include" /M
setx OPENSSL_LIBRARIES "%OPENSSL_DIR%\\lib" /M
setx OPENSSL_ROOT_DIR "%OPENSSL_DIR%\\OpenSSL" /M

:: Append OpenSSL bin directory to PATH if not already present
set "PATH_UPDATE=%OPENSSL_DIR%\\bin"
for /f "tokens=2* delims= " %%a in ('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path 2^>nul') do set "OLD_PATH=%%b"

echo %OLD_PATH% | findstr /I /C:"%PATH_UPDATE%" >nul
if errorlevel 1 (
    setx PATH "%OLD_PATH%;%PATH_UPDATE%" /M
    echo OpenSSL path added to system PATH.
) else (
    echo OpenSSL path is already in system PATH.
)

echo Environment variables set successfully!
pause
`;

const GAMELIFTFULLACCESSPOLICY = () => `

  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GameLiftFullAccess",
      "Effect": "Allow",
      "Action": "gamelift:*",
      "Resource": "*"
    }
  ]    
`;

const PostBoard = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedImageSrc, setExpandedImageSrc] = useState('');
  const [selectedGuide, setSelectedGuide] = useState('AWS GameLift Guide');

  const handleImageClick = (src) => {
    setExpandedImageSrc(src);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setExpandedImageSrc('');
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


  const post1 = () => {
    return (
      <div className='guide-box'>
          
      <h1>How to Deploy to AWS GameLift Step by Step</h1>
      <p>Guide to deploying an Unreal Engine Server to AWS GameLift.</p>
      <p>
        I created this guide out of pure frustration while struggling to find up-to-date information on integrating Unreal Engine with AWS GameLift. 
        The official documentation, readmes, and even a one-year-old YouTube video all left gaps that led to countless errors and roadblocks. 
        Despite following all the recommended steps, I repeatedly encountered issues that required additional troubleshooting and workarounds.
        This guide is meant to document everything I learned through trial and error, making it easier for others to get GameLift running smoothly without wasting hours debugging problems that aren't clearly addressed in existing resources.
      </p>

      <h5>Reference Links</h5>
        <a href="https://github.com/aws/amazon-gamelift-plugin-unreal/blob/main/README.md" target="_blank"> Official GameLift Unreal Plugin Readme</a><br/>
        <a href="https://docs.aws.amazon.com/gamelift/latest/developerguide/integration-engines-setup-unreal.html" target="_blank"> AWS GameLift Unreal Engine Integration Guide</a><br/>
        <a href="https://www.youtube.com/watch?v=HzffxtyyIOA" target="_blank"> YouTube Guide on GameLift Integration</a><br/>
      <p>
          In the following sections, I'll cover step-by-step instructions, common pitfalls, and solutions to issues you might encounter while setting up GameLift with Unreal Engine. 
          Let's dive in! 🚀
      </p>
      <div className='steps text-left'>
        <ul>
        <li><h2>Step 1:</h2> Download Unreal Engine source code and Visual Studio <br/>
          <p>There’s no workaround for this. I tried installing from Epic Games and skipping this step and ran into a "this version of Unreal doesn’t support server build". 
          So first, install Visual Studio 2022 and the necessary game development components for Unreal Engine development, Visual Studio tools, Windows 10 SDK, etc...&nbsp;
          <a href="https://visualstudio.microsoft.com/downloads/" target="_blank" rel="noreferrer">Visual Studio 2022</a></p>
          
          <div className="image-container" onClick={() => handleImageClick("https://s3.us-east-1.amazonaws.com/reimondev.com/vs2022components.JPG")}>
            <img src="https://s3.us-east-1.amazonaws.com/reimondev.com/vs2022components.JPG" alt="Unreal Engine Source Code" />
          </div>
          <br />
          <p>Download Unreal Engine source code from GitHub:
            <a href="https://github.com/EpicGames/UnrealEngine.git" target="_blank" rel="noreferrer"> Unreal Engine GitHub </a>
             or download the zip and extract it:
            <a href="https://github.com/EpicGames/UnrealEngine/archive/refs/heads/release.zip" target="_blank" rel="noreferrer"> Unreal Engine GitHub zip </a>.
            Otherwise you can use the command line to clone the repository:
          </p>
          <div className="command-container">
            <p className="command">
              <FontAwesomeIcon  className= "clipboard"
                icon={faClipboard} 
                onClick={() => copyToClipboard("git clone https://github.com/EpicGames/UnrealEngine.git")}
              /> git clone https://github.com/EpicGames/UnrealEngine.git
            </p> 
          </div>

            <p>After cloning the repository, run the setup.bat file in the root directory. This will download the necessary files and dependencies.</p>
            <div className="command-container">
              <p className="command">
                <FontAwesomeIcon  className= "clipboard"
                  icon={faClipboard} 
                  onClick={() => copyToClipboard(".\\Setup.bat")}
                /> .\Setup.bat
              </p> 
            </div>
            <p>After the setup is complete, run the GenerateProjectFiles.bat file.</p>
            <div className="command-container">
              <p className="command">
                <FontAwesomeIcon  className= "clipboard"
                  icon={faClipboard} 
                  onClick={() => copyToClipboard(".\\GenerateProjectFiles.bat")}
                /> .\GenerateProjectFiles.bat
              </p> 
            </div>
            <p>Open the <code>.sln</code> file in Visual Studio 2022, set UE5 as the startup project, and build the solution. This step takes the most time because the build process requires a lot of memory and processing power. Make sure to use the Development Editor configuration; otherwise, you’ll have to redo the process.</p>
            <p><b>NOTE:</b> The build process is very slow, especially on a hard disk drive (HDD). You need at least 300GB of free space, so it's highly recommended to use a high-speed NVMe M.2 SSD for better performance.</p>

            <div className="image-container" onClick={() => handleImageClick("https://s3.us-east-1.amazonaws.com/reimondev.com/unrealbuild.JPG")}>
              <img src="https://s3.us-east-1.amazonaws.com/reimondev.com/unrealbuild.JPG" alt="Unreal Engine Source Code" />
            </div>
            <br></br>
            Neat! Now you can run and modify your custom Unreal Engine build from source code. However, don’t change anything yet, because modifying the source code will trigger a rebuild of the engine.            <br></br>

          </li>

          <li><h2>Step 2:</h2> Get the latest GameLift plugins and SDK from AWS.<br />
            <p>Download the latest AWS SDK and GameLift plugin from the Unreal Engine Marketplace. You’ll need an AWS account and must be logged in to download the plugin.</p>

            <p><i>NOTE:</i> Cloning the repository is not recommended as it requires deleting some files and folders to avoid conflicts. However, if you choose to clone it, make sure to follow the README instructions in the GitHub repository.</p>

            <p>You can choose one of the following download options:</p>
            
            
            <li><strong>GameLift Plugin</strong> from GitHub:
              <a href="https://github.com/aws/amazon-gamelift-plugin-unreal" target="_blank" rel="noreferrer"> Unreal Engine GitHub Repository</a>&nbsp;  
              (<a href="https://github.com/aws/amazon-gamelift-plugin-unreal/archive/refs/heads/main.zip" target="_blank" rel="noreferrer">Direct ZIP Download</a>).
            </li>
            or
            <li><strong>C++ Server SDK Plugin</strong> for Unreal from AWS:
              <a href="https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/unreal/GameLift-Cpp-ServerSDK-UnrealPlugin-5.2.0.zip" target="_blank" rel="noreferrer"> Download Server SDK Plugin </a>.
            </li>

            <p>Both options contain the same files, but using the plugin from the <a href="https://aws.amazon.com/gamelift/servers/getting-started/" target="_blank" rel="noreferrer"> official AWS GameLift release</a> is recommended to avoid potential issues.</p>
            <p><strong>NOTE:</strong> Extract the downloaded files into the root directory to avoid "path is too long" errors.</p>
            <p>Since the C++ SDK is not included in the plugin, we need to download the project separately and build it ourselves to obtain the missing <code>.dll</code> and <code>.lib</code> files required for our previously downloaded plugin.</p>

            <li><strong>C++ SDK for Unreal</strong> from AWS:
              <a href="https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/cpp/GameLift-Cpp-ServerSDK-5.2.0.zip" target="_blank" rel="noreferrer"> Download SDK</a>
            </li>
            If all of this is too confusing, you can simply download it from this alternative source, which already includes both: 
            <li>The C++ Server SDK Plugin for Unreal project and the prebuilt C++ Server SDK:
              <a href="https://github.com/aws/amazon-gamelift-plugin-unreal/releases/download/v2.0.1/amazon-gamelift-plugin-unreal-release-2.0.1.zip" target="_blank" rel="noreferrer"> Amazon GameLift Plugin Unreal Release 2.0.1</a>
            </li>
            <p>Go to your extracted <strong>GameLift-Cpp-ServerSDK-5.2.0</strong> folder and follow the README instructions. Here, we will only cover the steps for Windows:</p>
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
              <strong>COPY</strong> the following two DLLs and save them to a safe location for later use (such as your desktop).
            </p>
            <li><code>libssl-3-x64.dll</code></li>
            <li><code>libcrypto-3-x64.dll</code></li>
            <p>
              <strong>These two DLLs must be included in your game server build when you upload it to Amazon GameLift.</strong>
            </p>
            <p>Copy the following script to your clipboard, paste it into a new text editor, and replace the OpenSSL installation path with your own. Save the file as a .bat script and run it to set the necessary environment variables.</p>
            <div className="command-container">
              <p className="command">
                <FontAwesomeIcon  className= "clipboard"
                  icon={faClipboard} 
                  onClick={() => copyToClipboard(SETOPENSSLPATHSBAT())}
                /> {SETOPENSSLPATHSBAT()}
              </p> 
            </div>
            <p>
            You can also set them manually in the system variables:
            </p>

            <pre>
              <strong>OPENSSL_INCLUDE_DIR</strong>
              C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin

              <strong>OPENSSL_LIBRARIES</strong>
              C:\Program Files\OpenSSL-Win64\lib

              <strong>OPENSSL_ROOT_DIR</strong>
              C:\Program Files\OpenSSL-Win64
            </pre>

            Download Python if you don’t have them installed already:
            <p>
              <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">Download Python</a>
            </p>
            Thats it you already have the necessary tools to build the SDK. Now you can follow the README instructions to build the SDK and get the .dll and .lib files required for the plugin.
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
            <div className="image-container" onClick={() => handleImageClick(" https://s3.us-east-1.amazonaws.com/reimondev.com/buildconfigurations.JPG")}>
              <img src="https://s3.us-east-1.amazonaws.com/reimondev.com/buildconfigurations.JPG" alt="Unreal Engine Source Code" />
            </div><br></br>
            <strong>Unreal Engine:</strong> To use GameLift with Unreal Engine, set <code>BUILD_FOR_UNREAL=1</code> and <code>BUILD_SHARED_LIBS=0</code> to create a single, self-contained library.<br></br>
            <strong>Standard C++ Projects (Non-Unreal):</strong> For standard C++ projects (not Unreal Engine), set <code>GAMELIFT_USE_STD=1</code> to use the standard C++ library.<br></br>
            <strong>Dynamic Linking:</strong> To use dynamic linking with shared libraries, set <code>BUILD_SHARED_LIBS=1</code>.<br></br>
            <p> For this scenario, we are using Unreal Engine, so use the following command:</p>
            <div className="command-container">
              <p className="command">
                <FontAwesomeIcon 
                  className="clipboard"
                  icon={faClipboard} 
                  onClick={() => copyToClipboard(`cmake -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release -DBUILD_FOR_UNREAL=1 -DBUILD_SHARED_LIBS=0 -S . -B ./cmake-build`)}
                /> 
                <code> cmake -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release -DBUILD_FOR_UNREAL=1 -DBUILD_SHARED_LIBS=0 -S . -B ./cmake-build</code>
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
              
            <p>Once the build is complete, you should have the necessary <b>.dll</b> and <b>.lib</b> files in the <b>cmake-build</b> directory. Follow these steps:</p>
            <p>-Navigate to <b>C:\GameLift-Cpp-ServerSDK-5.2.0\cmake-build\prefix</b>.</p>
            <p>-Inside the <b>lib</b> folder, copy the <b>aws-cpp-sdk-gamelift-server.lib</b> file to a temporary directory.</p>
            <p>-Then Inside the <b>bin</b>, copy the <b>aws-cpp-sdk-gamelift-server.dll</b> file to the same temporary directory.</p>
            <p>-After that, copy both the <b>aws-cpp-sdk-gamelift-server.lib</b> and <b>aws-cpp-sdk-gamelift-server.dll</b> files to the following directory:
            <b><br/>\amazon-gamelift-plugin-unreal\GameLiftPlugin\Source\GameLiftServer\ThirdParty\GameLiftServerSDK\Win64</b>
            </p>
            <p>Ensure both files are correctly copied. You should also find a <code>readme</code> file in that folder.</p>

            <p><b>NOTE:</b> This works only in a C++ multiplayer game project with game code. Projects that use Blueprints only are not compatible with this plugin at this time.</p>

            <p>Copy the plugin to the appropriate folder and verify it’s visible there. Copy the entire <b>GameLiftPlugin</b> folder with all contents inside and go to your Unreal C++ project. Create a folder named <b>Plugins</b> if one doesn't already exist.</p>

            <p>Right-click on the <code>.uproject</code> file and add the plugin by selecting "Edit."</p>

            <div class="command-container">
              <p class="command">
              <FontAwesomeIcon 
                  className="clipboard"
                  icon={faClipboard} 
                  onClick={() => copyToClipboard(UPROJECTPLUGINCONFIGURATION())}
                /> 
                {UPROJECTPLUGINCONFIGURATION()}
              </p> 
            </div>

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
              <a href="https://docs.aws.amazon.com/gamelift/latest/developerguide/integration-engines-setup-unreal.html" target="_blank"> official AWS documentation</a> for more details.
            </p>
            
            <h3>1. Add GameLift Dependency in Build.cs</h3>
            <p>Launch your Unreal Engine project using Visual Studio. Navigate to your Unreal project source folder and open the <b>Your-application-name.Target.cs</b> file.</p>
            <p>Modify the <b>.Build.cs</b> file to include the GameLift dependency:</p>
            <div class="command-container">
              <p class="command">
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
            <div class="command-container">
              <p class="command">
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

            <div class="command-container">
              <p class="command">
                <pre>
                  <code>
{`// Fill out your copyright notice in the Description page of Project Settings.

#include "AGameLiftUnrealAppGameMode.h"
#include "AGameLiftUnrealAppCharacter.h"
#include "UObject/ConstructorHelpers.h"
#include "aws/gamelift/server/GameLiftServerAPI.h"

#define GAMELIFT_USE_STD 0

using namespace Aws::GameLift::Server;

DEFINE_LOG_CATEGORY(GameServerLog);

AGameLiftUnrealAppGameMode::AGameLiftUnrealAppGameMode()
{
    // Set default pawn class to our Blueprinted character
    DefaultPawnClass = AUnknownVoidOnlineCharacter::StaticClass();
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

    // Callback: Perform Health Check (Amazon GameLift checks approximately every 60 seconds)
    auto onHealthCheck = []() -> bool
        {
            UE_LOG(GameServerLog, Log, TEXT("Performing Health Check"));
            return true;
        };
    m_params.OnHealthCheck.BindLambda(onHealthCheck);

    // Configure server settings
    m_params.port = 7777;  // Port for incoming player connections

    // Define log file locations (GameLift will upload these for debugging)
    m_params.logParameters = { TEXT("GameLift426Test/Saved/Logs/GameLift426Test.log") };

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

            <div class="command-container">
              <p class="command">
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
            <h2>Step 6:</h2> Create IAM users with full gamelift access policys and download aws cli .<br />
            <p>Download the latest AWS SDK and GameLift plugin from the Unreal Engine Marketplace. You’ll need an AWS account and must be logged in to download the plugin.</p>

              <p>Log in to your AWS account and navigate to IAM (Identity and Access Management). Create a new user named <strong>GameLiftUser</strong> and attach the following policy:</p>


              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon  className= "clipboard"
                    icon={faClipboard} 
                    onClick={() => copyToClipboard(SETOPENSSLPATHSBAT())}
                  /> {SETOPENSSLPATHSBAT()}
                </p> 
              </div>
              <pre>
              {`
                "Version": "2012-10-17",
                "Statement": [
                  {
                    "Sid": "GameLiftFullAccess",
                    "Effect": "Allow",
                    "Action": "gamelift:*",
                    "Resource": "*"
                  }
                ]
              `}
              </pre>

              <p>After that, generate the user's <strong>Access Key</strong> and <strong>Secret Key</strong> for command-line access.</p>

              <p>Run the following command to configure AWS CLI:</p>
              <pre>
              aws configure
              </pre>

              <p>Enter your Access Key, Secret Key, Region, and set the output format to <code>json</code>.</p>

              <p>To verify the configuration, run the following command:</p>
              <pre>
              aws sts get-caller-identity
              </pre>

              after windows serverbuild is done and you have the server files ready you can upload them to AWS GameLift using the following command bar jsut replace with your information:
              <div className="command-container">
                <p className="command">
                  <FontAwesomeIcon  className= "clipboard"
                    icon={faClipboard} 
                    onClick={() => copyToClipboard(UPLOADSERVERBAT())}
                  /> {UPLOADSERVERBAT()}
                </p> 
              </div>



            </li>


              {/* <li>
              <h2>Step 6:</h2>  */}

            {/* TEST
            <br/>
            before uploading to AWS GameLift, you can test your server build locally using GameLift Local.
            <p>Run the GameLift Local server to test your server build locally.</p>


create aws acccount and im user rola with all acces to s3 polices then generate ypourt kweys also install aws cli


aws configure

then

$env:AWS_REGION="us-west-2"
$env:AWS_ACCESS_KEY_ID="your_access_key"
$env:AWS_SECRET_ACCESS_KEY="your_secret_key"

            download GameLiftLocal-1.0.5 is inside GameLift-Cpp-ServerSDK-3.4.2.zip from aws website
            <a href="https://gamelift-server-sdk-release.s3.us-west-2.amazonaws.com/cpp/GameLift-Cpp-ServerSDK-3.4.2.zip" target="_blank" rel="noreferrer"> Download SDK</a>


            get java 11 from here:
            <a href="https://adoptium.net/temurin/releases/?version=11" target="_blank" rel="noreferrer"> JAVA 11 </a>

          

            <div class="command-container">
              <p class="command">
                <FontAwesomeIcon 
                  className="clipboard"
                  icon={faClipboard} 
                  onClick={() => copyToClipboard("java -jar GameLiftLocal.jar -p 9080")} 
                /> java -jar GameLiftLocal.jar -p 9080
                
              </p> 
            </div>
          
          </li> */}


       

          {/* <li><b>Step 5:</b> Create a new GameLift Build.<br />
            <p>Use the appropriate commands or create a deploy build script (.bat).</p>
            <p>You will also need an AWS account with access permissions to use AWS GameLift. See the documentation on <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html">Setting up programmatic access with long-term credentials</a> for more details.</p>
            <p>You’ll need a server target build and output. This will take some time. After the build is complete, proceed to add installation files and some OpenSSL .dll files.</p>
          </li> */}

          <li><b>Step 6:</b> Create a new GameLift Fleet.<br />
          Using the build files, you can create a new fleet in the AWS GameLift console. EC2 instances will be created, and the server build will be deployed to them. Select your build, give it a name and description, and then choose the instance type and the number of instances you want to create.<br />

          Next, add the runtime executable path. It should be inside your server build project folder, under the "binaries" folder, then "win64," and finally the .exe file.<br />

          Add UDP port 7777 with the IP address range of 0.0.0.0/0.<br />

          Afterward, click "Deploy." This will provide you with the IP address to connect to your server. You can use the IP in the "open" command from your game client’s command prompt to establish the connection.
          </li>

        </ul>
      </div>
    </div>
    );
  }

  const post2 = () => {
    return (




      <>more posts comming soon</>




    );
  };

  

  return (
    <div className='PostBoard'>
      <h1>PostBoard</h1>
      <div className='flex-grid-container'>
        <div className='download-button' onClick={() => setSelectedGuide('AWS GameLift Guide')}>
          <h5>AWS GameLift Guide</h5>
        </div>

        <div className='download-button' onClick={() => setSelectedGuide('AI Tree Link')}>
          <h5>AI Tree Link</h5>
        </div>

        <div className='download-button' onClick={() => setSelectedGuide('3D Cool Animations')}>
          <h5> 3D Cool Animations</h5>
        </div> 

        <div className='download-button'>
          <h5> ...</h5>
        </div>

      </div>

      <div className="container rt-video-container">
        {selectedGuide === 'AWS GameLift Guide' && post1()}
        {selectedGuide === 'AI Tree Link' && <AITools />}
        {selectedGuide === '3D Cool Animations' && <CoolAnimation/>}
      </div>

      {isModalOpen && (
        <div className="modal" onClick={handleModalClose}>
          <img src={expandedImageSrc} alt="Expanded" />
        </div>
      )}

    </div>
  );
}

export default PostBoard;
