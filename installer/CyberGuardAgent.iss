
#define MyAppName "CyberGuard Agent"
#define MyAppVersion "1.0.0"
#define MyAppExeName "CyberGuardAgent.exe"

[Setup]
AppId={{B84E7A10-DA52-4F92-98A4-0B27491F0C6D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=CyberGuard
DefaultDirName={localappdata}\Programs\CyberGuard Agent
DefaultGroupName=CyberGuard Agent
OutputDir=..\installer\output
OutputBaseFilename=CyberGuardSetup
Compression=lzma
SolidCompression=no
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "..\dist\CyberGuardAgent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\CyberGuard Agent"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\CyberGuard Agent"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch CyberGuard Agent"; Flags: nowait postinstall skipifsilent
