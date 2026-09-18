$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not ('ConsoleUi.NativeMethods' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace ConsoleUi {
  [StructLayout(LayoutKind.Sequential)]
  public struct COORD { public short X; public short Y; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CONSOLE_FONT_INFOEX {
    public uint cbSize;
    public uint nFont;
    public COORD dwFontSize;
    public int FontFamily;
    public int FontWeight;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string FaceName;
  }

  public static class NativeMethods {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool GetCurrentConsoleFontEx(IntPtr output, bool maximumWindow, ref CONSOLE_FONT_INFOEX info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetCurrentConsoleFontEx(IntPtr output, bool maximumWindow, ref CONSOLE_FONT_INFOEX info);
  }
}
'@
}

$handle = [ConsoleUi.NativeMethods]::GetStdHandle(-11)
$font = [ConsoleUi.CONSOLE_FONT_INFOEX]::new()
$font.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][ConsoleUi.CONSOLE_FONT_INFOEX])
if ([ConsoleUi.NativeMethods]::GetCurrentConsoleFontEx($handle, $false, [ref]$font)) {
  $font.dwFontSize.X = 0
  $font.dwFontSize.Y = 16
  $font.FaceName = 'Consolas'
  [void][ConsoleUi.NativeMethods]::SetCurrentConsoleFontEx($handle, $false, [ref]$font)
}
