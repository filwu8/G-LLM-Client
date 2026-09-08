// Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1
// Trusted launcher, compiled by Windows PowerShell/.NET Framework. The requested
// script is only passed to CreateProcess after SECURITY_CAPABILITIES and the job
// are installed. No administrative privilege or machine-wide ACL changes needed.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class GllmAppContainer {
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr Sid, Capabilities; public uint Count, Reserved; }
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags;
    public ushort showWindow,reserved2; public IntPtr reservedPtr, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO Startup; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSidToSid(string text,out IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr ptr);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr resultSize);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref EXTENDED_LIMIT limits,uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr result,uint access,bool inherit,uint options);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int information,out int value,int length,out int returned);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\') { slashes++; continue; }
      if(c=='"') { result.Append('\\',slashes*2+1); result.Append(c); slashes=0; continue; }
      result.Append('\\',slashes); slashes=0; result.Append(c);
    }
    result.Append('\\',slashes*2); return result.Append('"').ToString();
  }
  static void Grant(string directory, SecurityIdentifier sid) {
    // Only grant access on the throwaway snapshot, never the user's workspace.
    var acl=Directory.GetAccessControl(directory);
    acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.Modify | FileSystemRights.Synchronize, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    Directory.SetAccessControl(directory,acl);
    // Low integrity processes also need a low mandatory label on writable files.
    var start = new System.Diagnostics.ProcessStartInfo(Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),"System32","icacls.exe"), Quote(directory)+" /setintegritylevel (OI)(CI)L /T /Q");
    start.UseShellExecute=false; start.CreateNoWindow=true; start.RedirectStandardOutput=true; start.RedirectStandardError=true;
    using(var child=System.Diagnostics.Process.Start(start)) {
      var stdout=child.StandardOutput.ReadToEndAsync(); var stderr=child.StandardError.ReadToEndAsync();
      if(!child.WaitForExit(15000)) { child.Kill(); throw new Exception("Snapshot integrity-label setup timed out"); }
      if(child.ExitCode!=0) throw new Exception("Unable to label AppContainer snapshot");
    }
  }
  public static int Run(string executable,string[] args,string cwd,string work,string scratch,bool network,int timeoutMs) {
    string name="Gllm.Agent."+Guid.NewGuid().ToString("N");
    IntPtr sid=IntPtr.Zero, capabilities=IntPtr.Zero, capabilityBlock=IntPtr.Zero, attributes=IntPtr.Zero, job=IntPtr.Zero, handleList=IntPtr.Zero;
    IntPtr[] networkSids=new IntPtr[2]; IntPtr[] inherited=new IntPtr[3];
    PROCESS_INFORMATION process=new PROCESS_INFORMATION(); bool attributesReady=false;
    string stage="creating profile";
    try {
      int hr=CreateAppContainerProfile(name,name,"Temporary G-LLM execution sandbox",IntPtr.Zero,0,out sid);
      if(hr<0) Marshal.ThrowExceptionForHR(hr);
      var identity=new SecurityIdentifier(sid);
      stage="granting snapshot access";
      Grant(work,identity); Grant(scratch,identity);
      var security=new SECURITY_CAPABILITIES(); security.Sid=sid;
      stage="configuring capabilities and handles";
      if(network) {
        // Explicit user opt-in: outbound Internet and private network access.
        // No loopback exemptions, firewall edits or machine-wide capabilities.
        int itemSize=Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
        capabilities=Marshal.AllocHGlobal(itemSize*2);
        for(int i=0;i<2;i++) {
          Check(ConvertStringSidToSid(i==0 ? "S-1-15-3-1" : "S-1-15-3-3",out networkSids[i]));
          Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid=networkSids[i], Attributes=4 }, IntPtr.Add(capabilities,i*itemSize),false);
        }
        security.Capabilities=capabilities; security.Count=2;
      }
      capabilityBlock=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
      Marshal.StructureToPtr(security,capabilityBlock,false);
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
      attributes=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes,2,0,ref size)); attributesReady=true;
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20009),capabilityBlock,new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))),IntPtr.Zero,IntPtr.Zero));
      for(int i=0;i<3;i++) Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(i==0 ? -11 : i==1 ? -12 : -10),GetCurrentProcess(),out inherited[i],0,true,2));
      handleList=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.Copy(inherited,0,handleList,3);
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
      stage="configuring job limits";
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limits=new EXTENDED_LIMIT(); limits.Basic.Flags=0x2000 | 0x8 | 0x200; // kill on close, process count, job memory
      limits.Basic.ActiveProcessLimit=64; limits.JobMemory=new UIntPtr(1024UL*1024*1024);
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
      var startup=new STARTUPINFOEX(); startup.Startup.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.Attributes=attributes;
      startup.Startup.flags=0x100; startup.Startup.stdin=inherited[2]; startup.Startup.stdout=inherited[0]; startup.Startup.stderr=inherited[1];
      var command=new StringBuilder(Quote(executable));
      if(string.Equals(Path.GetFileName(executable),"cmd.exe",StringComparison.OrdinalIgnoreCase)) {
        // cmd /s /c has its own outer-quote rules, unlike CommandLineToArgvW.
        // Execute the generated batch file so multiline code and inner quotes
        // are preserved verbatim. /d disables host AutoRun registry commands.
        if(args.Length!=4 || args[3].IndexOf('"')>=0) throw new Exception("Invalid batch launcher arguments");
        command.Append(" /d /s /c \"\"").Append(args[3]).Append("\"\"");
      } else foreach(string argument in args) command.Append(" ").Append(Quote(argument));
      stage="creating restricted process";
      Check(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x80000 | 0x4 | 0x08000000,IntPtr.Zero,cwd,ref startup,out process));
      IntPtr token;
      stage="verifying restricted token";
      Check(OpenProcessToken(process.Process,8,out token));
      try { int appContainer, returned; Check(GetTokenInformation(token,29,out appContainer,4,out returned)); if(appContainer!=1) throw new Exception("Windows did not create an AppContainer token"); }
      finally { CloseHandle(token); }
      stage="assigning process to job";
      Check(AssignProcessToJobObject(job,process.Process));
      Check(ResumeThread(process.Thread)!=0xffffffff);
      stage="running restricted process";
      uint wait=WaitForSingleObject(process.Process,(uint)Math.Max(1000,Math.Min(600000,timeoutMs)));
      if(wait!=0) { TerminateJobObject(job,124); throw new Exception("AppContainer execution timed out or wait failed"); }
      uint exitCode; Check(GetExitCodeProcess(process.Process,out exitCode));
      TerminateJobObject(job,0); // stop any remaining descendants before copying outputs
      return unchecked((int)exitCode);
    } catch(Exception error) {
      throw new Exception("AppContainer " + stage + ": " + error.Message, error);
    } finally {
      if(process.Process!=IntPtr.Zero) { TerminateProcess(process.Process,125); CloseHandle(process.Process); }
      if(process.Thread!=IntPtr.Zero) CloseHandle(process.Thread);
      if(job!=IntPtr.Zero) CloseHandle(job);
      foreach(IntPtr handle in inherited) if(handle!=IntPtr.Zero) CloseHandle(handle);
      if(attributesReady) DeleteProcThreadAttributeList(attributes);
      foreach(IntPtr ptr in new[]{attributes,capabilityBlock,capabilities,handleList}) if(ptr!=IntPtr.Zero) Marshal.FreeHGlobal(ptr);
      foreach(IntPtr ptr in networkSids) if(ptr!=IntPtr.Zero) LocalFree(ptr);
      if(sid!=IntPtr.Zero) { FreeSid(sid); DeleteAppContainerProfile(name); }
    }
  }
}
