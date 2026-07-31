; Copyright (c) 2026 GPROPHET LIMITED
; SPDX-License-Identifier: BUSL-1.1
; Change Date: 2030-07-14

!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var GLLMInstallMode
Var GLLMDataRoot
Var GLLMDefaultDataRoot
Var GLLMModeDialog
Var GLLMModeIntroLabel
Var GLLMNormalRadio
Var GLLMNormalDescLabel
Var GLLMPortableRadio
Var GLLMPortableDescLabel
Var GLLMBrandLabel
Var GLLMDataDialog
Var GLLMDataIntroLabel
Var GLLMDataInput
Var GLLMDataBrowseButton
Var GLLMPreviousVersion
Var GLLMPreviousUninstallString

LangString GLLMPreviousVersionPrompt 1033 "G-LLM $GLLMPreviousVersion is already installed.$\r$\n$\r$\nThe old version must be uninstalled before this version is installed. Conversations, settings, and other user data will be preserved.$\r$\n$\r$\nContinue?"
LangString GLLMPreviousVersionPrompt 2052 "检测到已安装 G-LLM V$GLLMPreviousVersion。$\r$\n$\r$\n继续安装前将先卸载旧版本；会话、设置和其他用户数据会保留。$\r$\n$\r$\n是否继续？"

!macro customInit
  StrCpy $GLLMPreviousVersion ""
  StrCpy $GLLMPreviousUninstallString ""
  ReadRegStr $GLLMPreviousUninstallString HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $GLLMPreviousVersion HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $GLLMPreviousUninstallString == ""
    ReadRegStr $GLLMPreviousUninstallString HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ReadRegStr $GLLMPreviousVersion HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${EndIf}
  ${If} $GLLMPreviousUninstallString != ""
    ${If} $GLLMPreviousVersion == ""
      StrCpy $GLLMPreviousVersion "(unknown)"
    ${EndIf}
    IfSilent GLLMPreviousVersionConfirmed
    MessageBox MB_YESNO|MB_ICONINFORMATION|MB_DEFBUTTON1 "$(GLLMPreviousVersionPrompt)" /SD IDYES IDYES GLLMPreviousVersionConfirmed
    Abort
    GLLMPreviousVersionConfirmed:
    # electron-builder calls uninstallOldVersion before extracting the new application.
    # Its /KEEP_APP_DATA and --updated flags preserve conversations and settings during an upgrade.
  ${EndIf}
!macroend

LangString GLLMInstallModePageTitle 1033 "Choose installation mode"
LangString GLLMInstallModePageTitle 2052 "选择安装模式"
LangString GLLMInstallModePageSubtitle 1033 "Choose Standard or Portable before selecting folders."
LangString GLLMInstallModePageSubtitle 2052 "先选择普通版或便携版，再选择对应目录。"
LangString GLLMInstallModeIntro 1033 "G-LLM keeps assistants, conversations, knowledge base and settings locally. Pick the storage style that matches how you use this computer."
LangString GLLMInstallModeIntro 2052 "G-LLM 会把助手、会话、知识库和配置保存在本机。请选择适合当前电脑使用方式的版本。"
LangString GLLMInstallModeNormal 1033 "Standard installation (recommended)"
LangString GLLMInstallModeNormal 2052 "普通版（推荐）"
LangString GLLMInstallModeNormalDesc 1033 "Program files: C:\Program Files\GProphet\G-LLM. User data: %APPDATA%\G-LLM by default, and you can choose another data folder."
LangString GLLMInstallModeNormalDesc 2052 "程序默认安装到 C:\Program Files\GProphet\G-LLM；用户数据默认在 %APPDATA%\G-LLM，也可以另选数据目录。"
LangString GLLMInstallModePortable 1033 "Portable installation"
LangString GLLMInstallModePortable 2052 "便携版"
LangString GLLMInstallModePortableDesc 1033 "Program files and user data stay together. Data folder: Install folder\UserData. Good for USB drives or moving the whole folder."
LangString GLLMInstallModePortableDesc 2052 "程序和用户数据放在一起。数据目录：安装目录\UserData，适合 U 盘或整体迁移。"
LangString GLLMInstallModeBrand 1033 "Global Intelligence, Limitless Possibilities. Connect your own model gateway and keep your workspace local."
LangString GLLMInstallModeBrand 2052 "Global Intelligence, Limitless Possibilities。连接你的模型网关，把工作空间留在本地。"

LangString GLLMDataDirPageTitle 1033 "Choose data folder"
LangString GLLMDataDirPageTitle 2052 "选择数据目录"
LangString GLLMDataDirPageSubtitle 1033 "This folder stores conversations, assistants, knowledge base and provider settings."
LangString GLLMDataDirPageSubtitle 2052 "该目录保存会话、助手、本地知识库和供应商配置。"
LangString GLLMDataDirIntro 1033 "Standard mode separates program files from user data. The default is %APPDATA%\G-LLM. You may choose another writable folder."
LangString GLLMDataDirIntro 2052 "普通版会把程序文件和用户数据分开。默认目录是 %APPDATA%\G-LLM，你也可以选择其他可写目录。"
LangString GLLMDataDirLabel 1033 "Data folder:"
LangString GLLMDataDirLabel 2052 "数据目录："
LangString GLLMDataDirBrowse 1033 "Browse..."
LangString GLLMDataDirBrowse 2052 "浏览..."
LangString GLLMDataDirBrowseTitle 1033 "Choose G-LLM data folder"
LangString GLLMDataDirBrowseTitle 2052 "选择 G-LLM 数据目录"
LangString GLLMDataDirEmptyWarning 1033 "Please choose a data folder."
LangString GLLMDataDirEmptyWarning 2052 "请选择数据目录。"
LangString GLLMDataDirProgramFilesWarning 1033 "The data folder cannot be inside Program Files. Please choose a writable user folder."
LangString GLLMDataDirProgramFilesWarning 2052 "数据目录不能放在 Program Files 内，请选择一个普通用户可写的目录。"
LangString GLLMPortableDataPageTitle 1033 "Portable data folder"
LangString GLLMPortableDataPageTitle 2052 "便携版数据目录"
LangString GLLMPortableDataPageSubtitle 1033 "Portable mode stores data under the installation folder."
LangString GLLMPortableDataPageSubtitle 2052 "便携版会把数据保存在安装目录下。"
LangString GLLMPortableDataIntro 1033 "G-LLM will store user data in Install folder\UserData. Please avoid Program Files for portable mode."
LangString GLLMPortableDataIntro 2052 "G-LLM 会把用户数据保存在安装目录\UserData。便携版请不要安装到 Program Files。"
LangString GLLMPortableProgramFilesWarning 1033 "Portable mode stores data in the installation folder. Please go back and choose a writable folder outside Program Files, for example D:\G-LLM."
LangString GLLMPortableProgramFilesWarning 2052 "便携版会把数据写入安装目录。请返回上一步，选择 Program Files 之外的可写目录，例如 D:\G-LLM。"

!macro customWelcomePage
  Page custom GLLMInstallModePage GLLMInstallModeLeave
!macroend

!macro customPageAfterChangeDir
  Page custom GLLMDataDirPage GLLMDataDirLeave
!macroend

Function GLLMSetHeader
  Pop $1
  Pop $0
  GetDlgItem $2 $HWNDPARENT 1037
  SendMessage $2 0x000C 0 "STR:$0"
  GetDlgItem $2 $HWNDPARENT 1038
  SendMessage $2 0x000C 0 "STR:$1"
FunctionEnd

Function GLLMSetNormalInstallDir
  ${If} "$PROGRAMFILES64" != ""
    StrCpy $INSTDIR "$PROGRAMFILES64\GProphet\G-LLM"
  ${Else}
    StrCpy $INSTDIR "$PROGRAMFILES\GProphet\G-LLM"
  ${EndIf}
FunctionEnd

Function GLLMSetPortableInstallDir
  StrCpy $INSTDIR "$PROFILE\G-LLM"
FunctionEnd

Function GLLMInstallModePage
  Push "$(GLLMInstallModePageTitle)"
  Push "$(GLLMInstallModePageSubtitle)"
  Call GLLMSetHeader

  nsDialogs::Create 1018
  Pop $GLLMModeDialog
  ${If} $GLLMModeDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 30u "$(GLLMInstallModeIntro)"
  Pop $GLLMModeIntroLabel

  ${NSD_CreateRadioButton} 0 38u 100% 14u "$(GLLMInstallModeNormal)"
  Pop $GLLMNormalRadio
  ${NSD_CreateLabel} 18u 57u 92% 34u "$(GLLMInstallModeNormalDesc)"
  Pop $GLLMNormalDescLabel

  ${NSD_CreateRadioButton} 0 99u 100% 14u "$(GLLMInstallModePortable)"
  Pop $GLLMPortableRadio
  ${NSD_CreateLabel} 18u 118u 92% 30u "$(GLLMInstallModePortableDesc)"
  Pop $GLLMPortableDescLabel

  ${NSD_CreateLabel} 0 158u 100% 18u "$(GLLMInstallModeBrand)"
  Pop $GLLMBrandLabel

  ${If} $GLLMInstallMode == "portable"
    ${NSD_Check} $GLLMPortableRadio
  ${Else}
    StrCpy $GLLMInstallMode "normal"
    ${NSD_Check} $GLLMNormalRadio
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function GLLMInstallModeLeave
  ${NSD_GetState} $GLLMPortableRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $GLLMInstallMode "portable"
    Call GLLMSetPortableInstallDir
  ${Else}
    StrCpy $GLLMInstallMode "normal"
    Call GLLMSetNormalInstallDir
  ${EndIf}

  StrCpy $GLLMDefaultDataRoot "$APPDATA\G-LLM"
  StrCpy $GLLMDataRoot "$GLLMDefaultDataRoot"
FunctionEnd

Function GLLMDataDirPage
  ${If} $GLLMInstallMode == "portable"
    Push "$(GLLMPortableDataPageTitle)"
    Push "$(GLLMPortableDataPageSubtitle)"
    Call GLLMSetHeader
  ${Else}
    Push "$(GLLMDataDirPageTitle)"
    Push "$(GLLMDataDirPageSubtitle)"
    Call GLLMSetHeader
  ${EndIf}

  nsDialogs::Create 1018
  Pop $GLLMDataDialog
  ${If} $GLLMDataDialog == error
    Abort
  ${EndIf}

  ${If} $GLLMInstallMode == "portable"
    StrCpy $GLLMDataRoot "$INSTDIR\UserData"
    ${NSD_CreateLabel} 0 0 100% 34u "$(GLLMPortableDataIntro)"
    Pop $GLLMDataIntroLabel
    ${NSD_CreateLabel} 0 48u 100% 14u "$(GLLMDataDirLabel)"
    Pop $0
    ${NSD_CreateLabel} 0 68u 100% 30u "$GLLMDataRoot"
    Pop $0
  ${Else}
    ${If} $GLLMDataRoot == ""
      StrCpy $GLLMDataRoot "$APPDATA\G-LLM"
    ${EndIf}
    StrCpy $GLLMDefaultDataRoot "$APPDATA\G-LLM"
    ${NSD_CreateLabel} 0 0 100% 34u "$(GLLMDataDirIntro)"
    Pop $GLLMDataIntroLabel
    ${NSD_CreateLabel} 0 48u 100% 14u "$(GLLMDataDirLabel)"
    Pop $0
    ${NSD_CreateDirRequest} 0 68u 78% 14u "$GLLMDataRoot"
    Pop $GLLMDataInput
    ${NSD_CreateBrowseButton} 82% 67u 18% 16u "$(GLLMDataDirBrowse)"
    Pop $GLLMDataBrowseButton
    ${NSD_OnClick} $GLLMDataBrowseButton GLLMDataDirBrowse
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function GLLMDataDirBrowse
  Pop $0
  ${NSD_GetText} $GLLMDataInput $1
  nsDialogs::SelectFolderDialog "$(GLLMDataDirBrowseTitle)" "$1"
  Pop $2
  ${If} $2 != error
    ${NSD_SetText} $GLLMDataInput $2
  ${EndIf}
FunctionEnd

Function GLLMValidateDataRoot
  ${If} $GLLMDataRoot == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMDataDirEmptyWarning)"
    Abort
  ${EndIf}

  StrCpy $3 "$PROGRAMFILES\"
  StrLen $1 $3
  StrCpy $2 "$GLLMDataRoot\" $1
  ${If} $2 == $3
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMDataDirProgramFilesWarning)"
    Abort
  ${EndIf}

  ${If} "$PROGRAMFILES64" != ""
    StrCpy $3 "$PROGRAMFILES64\"
    StrLen $1 $3
    StrCpy $2 "$GLLMDataRoot\" $1
    ${If} $2 == $3
      MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMDataDirProgramFilesWarning)"
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Function GLLMDataDirLeave
  ${If} $GLLMInstallMode == "portable"
    StrCpy $GLLMDataRoot "$INSTDIR\UserData"
    StrCpy $3 "$PROGRAMFILES\"
    StrLen $1 $3
    StrCpy $2 "$INSTDIR\" $1
    ${If} $2 == $3
      MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMPortableProgramFilesWarning)"
      Abort
    ${EndIf}

    ${If} "$PROGRAMFILES64" != ""
      StrCpy $3 "$PROGRAMFILES64\"
      StrLen $1 $3
      StrCpy $2 "$INSTDIR\" $1
      ${If} $2 == $3
        MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMPortableProgramFilesWarning)"
        Abort
      ${EndIf}
    ${EndIf}
  ${Else}
    ${NSD_GetText} $GLLMDataInput $GLLMDataRoot
    Call GLLMValidateDataRoot
  ${EndIf}
FunctionEnd

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\gllm" "" "URL:G-LLM Protocol"
  WriteRegStr SHELL_CONTEXT "Software\Classes\gllm" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\gllm\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\gllm\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'

  ${If} $GLLMInstallMode == "portable"
    CreateDirectory "$INSTDIR\UserData"
    FileOpen $0 "$INSTDIR\portable.flag" w
    FileWrite $0 "portable"
    FileClose $0
    SetFileAttributes "$INSTDIR\portable.flag" HIDDEN
    FileOpen $0 "$INSTDIR\UserData\README.txt" w
    FileWrite $0 "G-LLM 便携版数据目录。聊天记录、助手、本地知识库、长期记忆和供应商配置会保存在这里。迁移软件时，请移动整个安装目录。$\r$\n"
    FileClose $0
  ${Else}
    Delete "$INSTDIR\portable.flag"
    StrCpy $GLLMDefaultDataRoot "$APPDATA\G-LLM"
    ${If} $GLLMDataRoot == ""
      StrCpy $GLLMDataRoot "$GLLMDefaultDataRoot"
    ${EndIf}
    CreateDirectory "$GLLMDefaultDataRoot"
    CreateDirectory "$GLLMDataRoot"
    ${If} $GLLMDataRoot == $GLLMDefaultDataRoot
      Delete "$GLLMDefaultDataRoot\data-location.txt"
      Delete "$GLLMDefaultDataRoot\data-location.json"
    ${Else}
      FileOpen $0 "$GLLMDefaultDataRoot\data-location.txt" w
      FileWrite $0 "$GLLMDataRoot"
      FileClose $0
    ${EndIf}
  ${EndIf}
!macroend
!endif

!ifdef BUILD_UNINSTALLER
Var GLLMUninstallDataRoot
Var GLLMUninstallDefaultDataRoot
Var GLLMUninstallDeleteData
Var GLLMUninstallDialog
Var GLLMUninstallIntroLabel
Var GLLMUninstallPathLabel
Var GLLMUninstallPathValueLabel
Var GLLMUninstallDeleteCheckbox
Var GLLMUninstallHintLabel

LangString GLLMUninstallDataPageTitle 1033 "Keep or delete local data"
LangString GLLMUninstallDataPageTitle 2052 "保留或删除本地数据"
LangString GLLMUninstallDataPageSubtitle 1033 "G-LLM keeps your conversations, assistants, generated images and provider settings locally."
LangString GLLMUninstallDataPageSubtitle 2052 "G-LLM 会把会话、助手、生成图片和供应商配置保存在本机。"
LangString GLLMUninstallDataIntro 1033 "Uninstalling the standard Windows app does not delete local data by default. Keep this folder if you may reinstall G-LLM later."
LangString GLLMUninstallDataIntro 2052 "Windows 标准版卸载时默认不会删除本地数据。如果你以后可能重新安装 G-LLM，请保留该目录。"
LangString GLLMUninstallDataPathLabel 1033 "Data folder:"
LangString GLLMUninstallDataPathLabel 2052 "数据目录："
LangString GLLMUninstallDeleteDataCheckbox 1033 "Also delete my G-LLM local data folder"
LangString GLLMUninstallDeleteDataCheckbox 2052 "同时删除我的 G-LLM 本地数据目录"
LangString GLLMUninstallDeleteDataHint 1033 "Only check this if you no longer need the local data. Deleted conversations, assistants, generated images and settings cannot be restored unless you have a backup."
LangString GLLMUninstallDeleteDataHint 2052 "仅在你确认不再需要本地数据时勾选。删除后，会话、助手、生成图片和设置无法恢复，除非你已有备份。"

!macro customUnWelcomePage
  UninstPage custom un.GLLMUninstallDataPage un.GLLMUninstallDataLeave
!macroend

!macro customUnInit
  StrCpy $GLLMUninstallDeleteData "0"
  Call un.GLLMResolveDataRoot
!macroend

!macro customUnInstall
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\gllm\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegKey SHELL_CONTEXT "Software\Classes\gllm"
  ${EndIf}

  ${If} $GLLMUninstallDeleteData == "1"
    ${If} $GLLMUninstallDataRoot != ""
      RMDir /r "$GLLMUninstallDataRoot"
    ${EndIf}
    ${If} $GLLMUninstallDefaultDataRoot != ""
    ${AndIf} $GLLMUninstallDefaultDataRoot != $GLLMUninstallDataRoot
      RMDir /r "$GLLMUninstallDefaultDataRoot"
    ${EndIf}
  ${EndIf}
!macroend

Function un.GLLMSetHeader
  Pop $1
  Pop $0
  GetDlgItem $2 $HWNDPARENT 1037
  SendMessage $2 0x000C 0 "STR:$0"
  GetDlgItem $2 $HWNDPARENT 1038
  SendMessage $2 0x000C 0 "STR:$1"
FunctionEnd

Function un.GLLMResolveDataRoot
  SetShellVarContext current
  StrCpy $GLLMUninstallDefaultDataRoot "$APPDATA\G-LLM"
  StrCpy $GLLMUninstallDataRoot "$GLLMUninstallDefaultDataRoot"

  InitPluginsDir
  FileOpen $0 "$PLUGINSDIR\gllm-resolve-data-root.ps1" w
  FileWrite $0 "$$default = Join-Path $$env:APPDATA 'G-LLM'$\r$\n"
  FileWrite $0 "$$path = $$default$\r$\n"
  FileWrite $0 "$$json = Join-Path $$default 'data-location.json'$\r$\n"
  FileWrite $0 "$$txt = Join-Path $$default 'data-location.txt'$\r$\n"
  FileWrite $0 "if (Test-Path -LiteralPath $$json) {$\r$\n"
  FileWrite $0 "  try {$\r$\n"
  FileWrite $0 "    $$config = Get-Content -Raw -LiteralPath $$json | ConvertFrom-Json$\r$\n"
  FileWrite $0 "    if ($$config.customDataRoot) { $$path = [string] $$config.customDataRoot }$\r$\n"
  FileWrite $0 "  } catch {}$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileWrite $0 "if ($$path -eq $$default -and (Test-Path -LiteralPath $$txt)) {$\r$\n"
  FileWrite $0 "  $$value = (Get-Content -Raw -LiteralPath $$txt).Trim()$\r$\n"
  FileWrite $0 "  if ($$value) { $$path = $$value }$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileWrite $0 "[Console]::Out.Write($$path)$\r$\n"
  FileClose $0

  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\gllm-resolve-data-root.ps1"'
  Pop $0
  Pop $1
  ${If} $0 == 0
  ${AndIf} $1 != ""
    StrCpy $GLLMUninstallDataRoot "$1"
  ${EndIf}
FunctionEnd

Function un.GLLMUninstallDataPage
  Call un.GLLMResolveDataRoot

  Push "$(GLLMUninstallDataPageTitle)"
  Push "$(GLLMUninstallDataPageSubtitle)"
  Call un.GLLMSetHeader

  nsDialogs::Create 1018
  Pop $GLLMUninstallDialog
  ${If} $GLLMUninstallDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 38u "$(GLLMUninstallDataIntro)"
  Pop $GLLMUninstallIntroLabel

  ${NSD_CreateLabel} 0 50u 100% 12u "$(GLLMUninstallDataPathLabel)"
  Pop $GLLMUninstallPathLabel

  ${NSD_CreateLabel} 0 68u 100% 32u "$GLLMUninstallDataRoot"
  Pop $GLLMUninstallPathValueLabel

  ${NSD_CreateCheckbox} 0 110u 100% 14u "$(GLLMUninstallDeleteDataCheckbox)"
  Pop $GLLMUninstallDeleteCheckbox
  ${NSD_Uncheck} $GLLMUninstallDeleteCheckbox

  ${NSD_CreateLabel} 18u 130u 92% 44u "$(GLLMUninstallDeleteDataHint)"
  Pop $GLLMUninstallHintLabel

  nsDialogs::Show
FunctionEnd

Function un.GLLMUninstallDataLeave
  ${NSD_GetState} $GLLMUninstallDeleteCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $GLLMUninstallDeleteData "1"
  ${Else}
    StrCpy $GLLMUninstallDeleteData "0"
  ${EndIf}
FunctionEnd
!endif
