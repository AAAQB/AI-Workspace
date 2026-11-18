// AI Workspace native command boundary. No full-trust fallback is provided.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

class SandboxRunner {
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved,lpDesktop,lpTitle; public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags; public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long perProcess,perJob; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSid(string s,out IntPtr p);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr p);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr result);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT info,uint len);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string n,uint access,uint share,IntPtr sa,uint create,uint flags,IntPtr template);
  static void Check(bool value,string context) { if(!value) throw new Win32Exception(Marshal.GetLastWin32Error(),context); }
  static string Quote(string arg) {
    if(arg.IndexOf('\0')>=0) throw new Exception("NUL in argument");
    var b=new StringBuilder("\""); int slashes=0;
    foreach(char c in arg) { if(c=='\\') { slashes++; continue; } if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); } else { b.Append('\\',slashes); b.Append(c); } slashes=0; }
    b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
  }
  static void NoLink(string path) {
    for(string p=Path.GetFullPath(path);!String.IsNullOrEmpty(p);p=Path.GetDirectoryName(p))
      if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0) throw new Exception("Reparse point is not allowed: "+p);
  }
  static void TreeNoLinks(string root) {
    NoLink(root);
    foreach(var p in Directory.EnumerateFileSystemEntries(root)) {
      if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0) throw new Exception("Project contains a link: "+p);
      if(Directory.Exists(p)) TreeNoLinks(p);
    }
  }
  static void Grant(string path,SecurityIdentifier sid,FileSystemRights rights,List<string> granted) {
    NoLink(path); var acl=Directory.GetAccessControl(path);
    acl.AddAccessRule(new FileSystemAccessRule(sid,rights,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    Directory.SetAccessControl(path,acl); granted.Add(path);
  }
  static int Main() {
    IntPtr sid=IntPtr.Zero,cap=IntPtr.Zero,capsMemory=IntPtr.Zero,scMemory=IntPtr.Zero,attrs=IntPtr.Zero,envMemory=IntPtr.Zero,job=IntPtr.Zero,nul=IntPtr.Zero,handleList=IntPtr.Zero;
    PROCESS_INFORMATION pi=new PROCESS_INFORMATION(); string profile="AIWorkspace."+Guid.NewGuid().ToString("N"); var granted=new List<string>(); SecurityIdentifier identity=null;
    try {
      Console.OutputEncoding=new UTF8Encoding(false);
      // Windows resolves an AppContainer profile from the launcher's LOCALAPPDATA.
      Environment.SetEnvironmentVariable("LOCALAPPDATA",Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
      var json=new JavaScriptSerializer(); var raw=Console.ReadLine(); if(raw==null) throw new Exception("Missing execution request");
      var spec=json.Deserialize<Dictionary<string,object>>(raw);
      string stage=Path.GetFullPath((string)spec["stage"]),cwd=Path.GetFullPath((string)spec["cwd"]),file=Path.GetFullPath((string)spec["file"]);
      if(cwd!=stage&&!cwd.StartsWith(stage+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new Exception("cwd escaped staging directory");
      TreeNoLinks(stage); NoLink(file);
      int hr=CreateAppContainerProfile(profile,"AI Workspace command","Isolated project execution",IntPtr.Zero,0,out sid);
      if(hr!=0) Marshal.ThrowExceptionForHR(hr);
      identity=new SecurityIdentifier(sid); Grant(stage,identity,FileSystemRights.FullControl,granted);
      foreach(object p in (System.Collections.IEnumerable)spec["runtimeRoots"]) {
        string runtime=Path.GetFullPath((string)p);
        if(runtime==Path.GetPathRoot(runtime)) throw new Exception("A whole drive cannot be a runtime root");
        if(!granted.Contains(runtime)) Grant(runtime,identity,FileSystemRights.ReadAndExecute,granted);
      }
      var sc=new SECURITY_CAPABILITIES(); sc.AppContainerSid=sid;
      if((bool)spec["network"]) {
        Check(ConvertStringSidToSid("S-1-15-3-1",out cap),"network capability");
        capsMemory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)));
        Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid=cap,Attributes=4 },capsMemory,false);
        sc.Capabilities=capsMemory; sc.CapabilityCount=1;
      }
      scMemory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))); Marshal.StructureToPtr(sc,scMemory,false);
      IntPtr bytes=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref bytes);
      attrs=Marshal.AllocHGlobal(bytes); Check(InitializeProcThreadAttributeList(attrs,2,0,ref bytes),"initialize sandbox attributes");
      Check(UpdateProcThreadAttribute(attrs,0,(IntPtr)0x00020009,scMemory,(IntPtr)Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)),IntPtr.Zero,IntPtr.Zero),"AppContainer security attributes");
      job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
      var limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000; Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),"configure child-process cleanup");
      var environment=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(var e in (Dictionary<string,object>)spec["env"]) environment[e.Key]=Convert.ToString(e.Value);
      var block=new StringBuilder(); foreach(var e in environment) block.Append(e.Key+"="+e.Value+'\0'); block.Append('\0'); envMemory=Marshal.StringToHGlobalUni(block.ToString());
      var command=new StringBuilder(Quote(file)); foreach(object arg in (System.Collections.IEnumerable)spec["args"]) command.Append(" "+Quote((string)arg));
      nul=CreateFile("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
      var inherited=new IntPtr[]{nul,GetStdHandle(-11),GetStdHandle(-12)};
      handleList=Marshal.AllocHGlobal(IntPtr.Size*3);
      for(int i=0;i<3;i++){Check(SetHandleInformation(inherited[i],1,1),"prepare standard handles");Marshal.WriteIntPtr(handleList,i*IntPtr.Size,inherited[i]);}
      Check(UpdateProcThreadAttribute(attrs,0,(IntPtr)0x00020002,handleList,(IntPtr)(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"limit inherited handles");
      var startup=new STARTUPINFOEX(); startup.StartupInfo.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.lpAttributeList=attrs;
      startup.StartupInfo.dwFlags=0x100; startup.StartupInfo.hStdInput=nul; startup.StartupInfo.hStdOutput=GetStdHandle(-11); startup.StartupInfo.hStdError=GetStdHandle(-12);
      Check(CreateProcess(file,command,IntPtr.Zero,IntPtr.Zero,true,0x00080000|0x00000400|0x08000000|0x00000004,envMemory,cwd,ref startup,out pi),"launch isolated command");
      if(!AssignProcessToJobObject(job,pi.process)) { TerminateProcess(pi.process,125); throw new Win32Exception(Marshal.GetLastWin32Error(),"attach process cleanup job"); }
      IntPtr runningJob=job;
      Task.Run(()=> { try { Console.In.ReadToEnd(); TerminateJobObject(runningJob,130); } catch {} });
      if(ResumeThread(pi.thread)==0xffffffff) throw new Win32Exception();
      WaitForSingleObject(pi.process,0xffffffff); uint result; GetExitCodeProcess(pi.process,out result);
      TerminateJobObject(job,result); CloseHandle(job); job=IntPtr.Zero;
      return unchecked((int)result);
    } catch(Exception e) {
      if(pi.process!=IntPtr.Zero) TerminateProcess(pi.process,125);
      Console.Error.WriteLine("\nAIW_SANDBOX_ERROR: "+e.Message+(e is Win32Exception ? " (Windows error "+((Win32Exception)e).NativeErrorCode+")" : "")); return 125;
    } finally {
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero) CloseHandle(pi.process);
      if(nul!=IntPtr.Zero&&nul!=(IntPtr)(-1)) CloseHandle(nul);
      foreach(string path in granted) try { var acl=Directory.GetAccessControl(path); acl.PurgeAccessRules(identity); Directory.SetAccessControl(path,acl); } catch {}
      if(attrs!=IntPtr.Zero) { DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs); }
      if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      if(scMemory!=IntPtr.Zero) Marshal.FreeHGlobal(scMemory); if(capsMemory!=IntPtr.Zero) Marshal.FreeHGlobal(capsMemory);
      if(envMemory!=IntPtr.Zero) Marshal.FreeHGlobal(envMemory); if(cap!=IntPtr.Zero) LocalFree(cap); if(sid!=IntPtr.Zero) FreeSid(sid);
      DeleteAppContainerProfile(profile);
    }
  }
}
