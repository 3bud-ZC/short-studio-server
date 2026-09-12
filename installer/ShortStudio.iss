; ==============================================================================
; Short Studio Server 2.6.0 - Commercial Windows Installer Specification
; ==============================================================================

#define MyAppName "Short Studio"
#define MyAppVersion "2.6.0"
#define MyAppPublisher "Short Studio"
#define MyAppURL "https://github.com/3bud-ZC/Abud-Shorts-Engine"
#define MyClientPkgDir "..\Short-Studio-Server-2.6.0-Client"

[Setup]
AppId={{E58E29B1-25D4-4903-85E9-968A7DCFE123}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} Server {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={code:GetDefaultDir}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile={#MyClientPkgDir}\LICENSE.txt
OutputDir=..\dist-commercial
OutputBaseFilename=ShortStudio-Setup-2.6.0
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName} Server {#MyAppVersion}
CreateUninstallRegKey=yes
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to the Short Studio Setup Wizard
WelcomeLabel2=This will install Short Studio Server %1 on your computer.%n%nShort Studio is the standalone AI automated short-video production system for Arabic and English shorts, reels, and TikToks.%n%nIt is strongly recommended that you ensure Docker Desktop is running before continuing.

[Files]
; Verified official client package archive & manifest
Source: "{#MyClientPkgDir}\Short-Studio-Server-2.6.0.tar.gz"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "{#MyClientPkgDir}\Short-Studio-Server-2.6.0.tar.gz.sha256"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "{#MyClientPkgDir}\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyClientPkgDir}\README-CUSTOMER.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyClientPkgDir}\START-HERE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyClientPkgDir}\update-manifest.json"; DestDir: "{app}"; Flags: ignoreversion

; Installation and uninstall engine helpers
Source: "run-install.ps1"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "prereq-check.ps1"; DestDir: "{tmp}"; Flags: ignoreversion dontcopy
Source: "uninstall-helper.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "http://127.0.0.1:{code:GetPort}"; Description: "Launch Short Studio Web Dashboard"; Flags: postinstall shellexec skipifsilent nowait

[Code]
var
  PrereqPage: TWizardPage;
  PrereqStatusMemo: TNewMemo;
  PrereqPassed: Boolean;
  RecheckBtn: TNewButton;

function GetDefaultDir(Param: String): String;
var
  CustomDir: String;
begin
  CustomDir := ExpandConstant('{param:INSTALLROOT|}');
  if CustomDir <> '' then
    Result := CustomDir
  else
    Result := ExpandConstant('{commonappdata}\ShortStudio');
end;

function GetInstallRoot(Param: String): String;
begin
  Result := GetDefaultDir('');
end;

function GetPort(Param: String): String;
begin
  Result := ExpandConstant('{param:PORT|3130}');
end;

function GetComposeProject(Param: String): String;
begin
  Result := ExpandConstant('{param:COMPOSEPROJECT|short-studio}');
end;

function GetLocalVoice(Param: String): String;
begin
  Result := ExpandConstant('{param:LOCALVOICE|AUTO}');
end;

procedure RunPrereqCheck();
var
  ResultCode: Integer;
  ReportPath: String;
  ReportLines: TArrayOfString;
  MemoText: String;
  I: Integer;
begin
  WizardForm.NextButton.Enabled := False;
  ReportPath := ExpandConstant('{tmp}\prereq-report.txt');
  if FileExists(ReportPath) then
    DeleteFile(ReportPath);

  ExtractTemporaryFile('prereq-check.ps1');

  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
    ExpandConstant('{tmp}\prereq-check.ps1') +
    '" -ReportFile "' + ReportPath +
    '" -Port ' + GetPort('') +
    ' -InstallRoot "' + GetInstallRoot('') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if FileExists(ReportPath) then
  begin
    if LoadStringsFromFile(ReportPath, ReportLines) then
    begin
      MemoText := '';
      for I := 0 to GetArrayLength(ReportLines) - 1 do
      begin
        if I > 0 then MemoText := MemoText + #13#10;
        MemoText := MemoText + ReportLines[I];
      end;
      PrereqStatusMemo.Text := MemoText;
    end;
  end
  else
  begin
    PrereqStatusMemo.Text := 'Unable to load prerequisite report.';
  end;

  if ResultCode = 0 then
  begin
    PrereqPassed := True;
    WizardForm.NextButton.Enabled := True;
  end
  else
  begin
    PrereqPassed := False;
    WizardForm.NextButton.Enabled := False;
  end;
end;

procedure RecheckBtnClick(Sender: TObject);
begin
  RunPrereqCheck();
end;

procedure InitializeWizard();
begin
  PrereqPage := CreateCustomPage(wpLicense,
    'System Prerequisites Check',
    'Verifying environment, Docker Desktop, and system readiness');

  PrereqStatusMemo := TNewMemo.Create(PrereqPage);
  PrereqStatusMemo.Parent := PrereqPage.Surface;
  PrereqStatusMemo.Left := 0;
  PrereqStatusMemo.Top := 0;
  PrereqStatusMemo.Width := PrereqPage.SurfaceWidth;
  PrereqStatusMemo.Height := PrereqPage.SurfaceHeight - 36;
  PrereqStatusMemo.ReadOnly := True;
  PrereqStatusMemo.ScrollBars := ssVertical;
  PrereqStatusMemo.Font.Name := 'Consolas';
  PrereqStatusMemo.Font.Size := 9;
  PrereqStatusMemo.Text := 'Running initial system check...';

  RecheckBtn := TNewButton.Create(PrereqPage);
  RecheckBtn.Parent := PrereqPage.Surface;
  RecheckBtn.Left := 0;
  RecheckBtn.Top := PrereqPage.SurfaceHeight - 30;
  RecheckBtn.Width := 110;
  RecheckBtn.Height := 28;
  RecheckBtn.Caption := 'Re-check';
  RecheckBtn.OnClick := @RecheckBtnClick;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (PrereqPage <> nil) and (CurPageID = PrereqPage.ID) then
  begin
    RunPrereqCheck();
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (PrereqPage <> nil) and (CurPageID = PrereqPage.ID) then
  begin
    if not PrereqPassed then
    begin
      MsgBox('One or more prerequisites are not met.' + #13#10 + #13#10 +
             'Please review the status window above, start Docker Desktop if necessary, and click "Re-check".',
             mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  TargetRoot: String;
  CmdParams: String;
begin
  if CurStep = ssPostInstall then
  begin
    TargetRoot := GetInstallRoot('');

    CmdParams := '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
      ExpandConstant('{tmp}\run-install.ps1') + '"' +
      ' -PackageArchive "' + ExpandConstant('{tmp}\Short-Studio-Server-2.6.0.tar.gz') + '"' +
      ' -ExpectedSha256 "181e5aca3aac19ff0657b315ec1b99e3ac7b08f4940b78e6a015e856dd25688d"' +
      ' -InstallRoot "' + TargetRoot + '"' +
      ' -Port ' + GetPort('') +
      ' -ComposeProject "' + GetComposeProject('') + '"' +
      ' -LocalVoice "' + GetLocalVoice('') + '"';

    if not WizardSilent then
      WizardForm.StatusLabel.Caption := 'Executing installation engine and starting Short Studio services...';

    Log('CmdParams: ' + CmdParams);
    if not Exec('powershell.exe', CmdParams, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    begin
      Log('Exec failed with ResultCode: ' + IntToStr(ResultCode));
      if not WizardSilent then
      begin
        MsgBox('Short Studio Server installation failed (Exit Code: ' + IntToStr(ResultCode) + ').' + #13#10 +
               'Check the installer log file under: ' + TargetRoot + '\logs\installer.log',
               mbError, MB_OK);
      end;
      Abort;
    end;
    Log('CurStep ssPostInstall completed successfully');
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := MsgBox('Are you sure you want to uninstall Short Studio Server?' + #13#10 + #13#10 +
                   'NOTE: Customer projects, videos, media, database volumes, backups, ' +
                   'and settings are safely PRESERVED by default.',
                   mbConfirmation, MB_YESNO) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  AppDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    AppDir := ExpandConstant('{app}');
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + AppDir + '\uninstall-helper.ps1" -InstallRoot "' + AppDir + '" -ComposeProject "' + GetComposeProject('') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
