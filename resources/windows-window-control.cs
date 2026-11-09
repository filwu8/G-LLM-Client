/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 — Change Date: 2030-08-01 */
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class GllmWindowControl
{
    private static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "chrome", "msedge", "360se", "360chrome", "360chromex", "firefox", "brave", "opera", "vivaldi"
    };

    public class WindowState
    {
        public string handle, process, started, title;
        public int pid;
        public int left, top, width, height;
    }

    public class Control
    {
        public string id, role, name;
        public bool editable, password;
    }

    public class Request
    {
        public string action, text, direction, document;
        public int ownerPid;
        public bool browserOnly;
        public WindowState window;
        public Control control;
        public int? x, y;
        public ushort[] keys;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Frame { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput { public int X, Y, Data; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputData
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyInput Key;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint Type; public InputData Data; }

    private delegate bool WindowVisitor(IntPtr handle, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowVisitor visitor, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowVisitor visitor, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int capacity);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out int pid);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr handle, out Frame bounds);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr handle, IntPtr dc, uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowDisplayAffinity(IntPtr handle, out uint affinity);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr handle, uint flags);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out Frame bounds, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out int value, int size);

    public static string Run(string json)
    {
        var serializer = new JavaScriptSerializer();
        IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4)); // Per monitor v2, physical pixels.
        try
        {
            return serializer.Serialize(Execute(serializer.Deserialize<Request>(json)));
        }
        catch (Exception error)
        {
            return serializer.Serialize(new { error = error.Message });
        }
        finally
        {
            if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
        }
    }

    private static WindowState Inspect(IntPtr handle, Request request)
    {
        int cloaked, pid;
        if (!IsWindowVisible(handle) || (DwmGetWindowAttribute(handle, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0)) return null;
        var title = new StringBuilder(512);
        if (GetWindowText(handle, title, title.Capacity) == 0 || GetWindowThreadProcessId(handle, out pid) == 0 || pid == request.ownerPid) return null;

        try
        {
            using (var process = Process.GetProcessById(pid))
            {
                string name = process.ProcessName;
                if (request.browserOnly && !Browsers.Contains(name)) return null;
                Frame bounds;
                if (DwmGetWindowAttribute(handle, 9, out bounds, Marshal.SizeOf(typeof(Frame))) != 0 && !GetWindowRect(handle, out bounds)) return null;
                return new WindowState {
                    handle = handle.ToInt64().ToString(), pid = pid, process = name, title = title.ToString(),
                    started = process.StartTime.ToUniversalTime().Ticks.ToString(),
                    left = bounds.Left, top = bounds.Top, width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top
                };
            }
        }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (System.ComponentModel.Win32Exception) { return null; }
    }

    private static WindowState RequireWindow(IntPtr handle, Request request)
    {
        WindowState current = Inspect(handle, request);
        if (current == null || current.pid != request.window.pid || current.started != request.window.started)
            throw new InvalidOperationException("The selected window is gone. List windows again.");
        if (current.title != request.window.title)
            throw new InvalidOperationException("The window title changed. List windows again to confirm the target.");
        return current;
    }

    private static void RequireForeground(IntPtr handle)
    {
        if (GetForegroundWindow() != handle)
            throw new InvalidOperationException("Windows could not focus the selected window. Bring it forward and try again.");
    }

    private static void Focus(IntPtr handle)
    {
        if (GetForegroundWindow() == handle) return;
        if (IsIconic(handle)) ShowWindowAsync(handle, 9); // SW_RESTORE
        SetForegroundWindow(handle);
        for (int attempt = 0; attempt < 10 && GetForegroundWindow() != handle; attempt++) Thread.Sleep(30);
        RequireForeground(handle);
    }

    private sealed class Observation
    {
        public string document;
        public readonly List<string> text = new List<string>();
        public readonly List<Control> controls = new List<Control>();
        public AutomationElement target;
    }

    private static Observation Observe(IntPtr handle, Request request, bool renderer = false)
    {
        var observation = new Observation();
        var walker = TreeWalker.ControlViewWalker;
        var cache = new CacheRequest { TreeScope = TreeScope.Element };
        foreach (var property in new[] { AutomationElement.NameProperty, AutomationElement.ControlTypeProperty,
            AutomationElement.IsOffscreenProperty, AutomationElement.IsEnabledProperty, AutomationElement.IsPasswordProperty,
            AutomationElement.IsValuePatternAvailableProperty }) cache.Add(property);

        var pending = new Queue<Tuple<AutomationElement, bool>>();
        using (cache.Activate()) pending.Enqueue(Tuple.Create(AutomationElement.FromHandle(handle), renderer));
        int inspected = 0, textLength = 0;
        while (pending.Count != 0 && inspected++ < 450)
        {
            var entry = pending.Dequeue();
            AutomationElement element = entry.Item1;
            bool inDocument = entry.Item2;
            if (inspected > 1 || renderer)
            {
                try
                {
                    var current = element.Cached;
                    var role = current.ControlType;
                    inDocument |= role == ControlType.Document;
                    if (!current.IsOffscreen && !current.IsPassword)
                    {
                        string name = Limit(current.Name, 160);
                        if (request.browserOnly && role == ControlType.Document && observation.document == null)
                            observation.document = RuntimeId(element);
                        if (role == ControlType.Text && name.Length != 0 && textLength < 3200)
                        {
                            observation.text.Add(name);
                            textLength += name.Length;
                        }
                        if (current.IsEnabled && IsControl(role) && (request.control != null || observation.controls.Count < 60))
                        {
                            var control = new Control {
                                id = RuntimeId(element), role = role.ProgrammaticName.Substring("ControlType.".Length), name = name,
                                editable = role == ControlType.Edit && (!request.browserOnly || inDocument) &&
                                    (bool)element.GetCachedPropertyValue(AutomationElement.IsValuePatternAvailableProperty)
                            };
                            if (request.control == null) observation.controls.Add(control);
                            else if (request.control.id == control.id && request.control.role == control.role && request.control.name == control.name && request.control.editable == control.editable)
                                observation.target = element;
                        }
                    }
                    else if (!current.IsOffscreen && current.IsPassword && current.IsEnabled && request.control == null && observation.controls.Count < 60)
                        observation.controls.Add(new Control { id = RuntimeId(element), role = "Edit", name = "Password (manual input)", password = true });
                }
                catch (ElementNotAvailableException) { continue; }
            }
            for (var child = walker.GetFirstChild(element, cache); child != null && inspected + pending.Count < 450; child = walker.GetNextSibling(child, cache))
                pending.Enqueue(Tuple.Create(child, inDocument));
        }
        return observation;
    }

    private static Observation ObserveWindow(IntPtr handle, Request request)
    {
        var observation = Observe(handle, request);
        if (!request.browserOnly || observation.document != null) return observation;

        // Chromium enables web accessibility lazily. Query its visible renderer's
        // native UIA provider when the browser root initially contains only its toolbar.
        IntPtr renderer = IntPtr.Zero;
        EnumChildWindows(handle, delegate(IntPtr child, IntPtr data) {
            var name = new StringBuilder(64);
            GetClassName(child, name, name.Capacity);
            if (!IsWindowVisible(child) || name.ToString() != "Chrome_RenderWidgetHostHWND") return true;
            renderer = child;
            return false;
        }, IntPtr.Zero);
        if (renderer == IntPtr.Zero) return observation;
        try
        {
            AutomationElement.FromHandle(renderer).GetCurrentPropertyValue(AutomationElement.ControlTypeProperty);
            Thread.Sleep(150);
            var content = Observe(renderer, request, true);
            if (content.document == null && content.controls.Count == 0 && content.target == null) return Observe(handle, request);
            content.controls.AddRange(observation.controls.GetRange(0, Math.Min(observation.controls.Count, 60 - content.controls.Count)));
            if (content.target == null) content.target = observation.target;
            return content;
        }
        catch (ElementNotAvailableException) { return observation; }
    }

    private static string RuntimeId(AutomationElement element) { return String.Join(".", element.GetRuntimeId()); }
    private static string Limit(string text, int length) { return text == null ? "" : text.Length > length ? text.Substring(0, length) : text; }

    private static bool IsControl(ControlType role)
    {
        return role == ControlType.Button || role == ControlType.Hyperlink || role == ControlType.Edit ||
            role == ControlType.CheckBox || role == ControlType.RadioButton || role == ControlType.ComboBox ||
            role == ControlType.ListItem || role == ControlType.TreeItem || role == ControlType.TabItem ||
            role == ControlType.MenuItem || role == ControlType.DataItem;
    }

    private static object Execute(Request request)
    {
        if (request.action == "list_windows")
        {
            var windows = new List<WindowState>();
            EnumWindows(delegate(IntPtr handle, IntPtr data) {
                WindowState window = Inspect(handle, request);
                if (window != null) windows.Add(window);
                return windows.Count < 40;
            }, IntPtr.Zero);
            return new { windows = windows };
        }

        var selected = new IntPtr(Int64.Parse(request.window.handle));
        WindowState current = RequireWindow(selected, request);
        if (request.action == "focus")
        {
            Focus(selected);
            return new { done = true };
        }
        if (IsIconic(selected)) throw new InvalidOperationException("The selected window is minimized. Use focus before taking a snapshot or sending input.");
        if (request.action == "screenshot") return Capture(selected, current);

        Observation observation = null;
        if (request.action == "snapshot" || request.control != null || request.document != null) observation = ObserveWindow(selected, request);
        if (request.action == "snapshot")
        {
            RequireWindow(selected, request);
            return new { window = current, document = observation.document, controls = observation.controls, text = observation.text };
        }
        if (request.document != null && request.document != observation.document)
            throw new InvalidOperationException("The browser page changed. Take a new snapshot before acting.");
        if (request.control != null && observation.target == null)
            throw new InvalidOperationException("The control changed or disappeared. Take a new snapshot before acting.");

        Focus(selected);
        current = RequireWindow(selected, request);
        if (request.x.HasValue && (current.left != request.window.left || current.top != request.window.top ||
            current.width != request.window.width || current.height != request.window.height))
            throw new InvalidOperationException("The window moved or resized. Take a new screenshot before using coordinates.");

        if (request.action == "fill")
        {
            object pattern;
            if (observation.target.Current.IsPassword || !observation.target.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) || ((ValuePattern)pattern).Current.IsReadOnly)
                throw new InvalidOperationException("This field requires manual input or is read-only.");
            RequireForeground(selected);
            ((ValuePattern)pattern).SetValue(request.text);
        }
        else if (request.action == "click" || request.action == "scroll")
        {
            Point point;
            if (request.control != null)
            {
                if (ActivateControl(observation.target)) return new { done = true };
                System.Windows.Point location;
                if (!observation.target.TryGetClickablePoint(out location))
                    throw new InvalidOperationException("The control is not clickable. Bring it into view or take a screenshot.");
                point = new Point { X = (int)location.X, Y = (int)location.Y };
            }
            else point = new Point { X = request.x ?? (current.left + current.width / 2), Y = request.y ?? (current.top + current.height / 2) };
            Input move = PointerMove(selected, point);
            Send(selected, request.action == "scroll" ? new[] { move, Mouse(0x0800, request.direction == "up" ? 480 : -480) } : new[] { move, Mouse(0x0002), Mouse(0x0004) });
        }
        else if (request.action == "type" || request.action == "navigate" || request.action == "press")
        {
            var inputs = new List<Input>();
            if (request.action == "type" && AutomationElement.FocusedElement.Current.IsPassword)
                throw new InvalidOperationException("Enter passwords manually.");
            if (request.action == "navigate") AddChord(inputs, new ushort[] { 0x11, 0x4c }); // Ctrl+L
            if (request.text != null)
            {
                foreach (char character in request.text)
                {
                    inputs.Add(Key(0, character, 0x0004));
                    inputs.Add(Key(0, character, 0x0006));
                }
            }
            if (request.action == "navigate") AddChord(inputs, new ushort[] { 0x0d }); // Enter
            if (request.action == "press") AddChord(inputs, request.keys);
            Send(selected, inputs.ToArray());
        }
        else throw new InvalidOperationException("Unsupported window action.");
        return new { done = true };
    }

    private static bool ActivateControl(AutomationElement control)
    {
        object pattern;
        if (control.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) ((InvokePattern)pattern).Invoke();
        else if (control.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) ((SelectionItemPattern)pattern).Select();
        else if (control.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) ((TogglePattern)pattern).Toggle();
        else return false;
        return true;
    }

    private static object Capture(IntPtr handle, WindowState window)
    {
        uint affinity;
        if (GetWindowDisplayAffinity(handle, out affinity) && affinity != 0)
            throw new InvalidOperationException("The selected window is protected from screen capture.");
        Frame full;
        if (!GetWindowRect(handle, out full)) throw new InvalidOperationException("The selected window has no capturable frame.");
        int width = full.Right - full.Left, height = full.Bottom - full.Top;
        var crop = new Rectangle(window.left - full.Left, window.top - full.Top, window.width, window.height);
        if (width < 1 || height < 1 || (long)width * height > 40000000 || crop.Width < 1 || crop.Height < 1 ||
            !new Rectangle(0, 0, width, height).Contains(crop))
            throw new InvalidOperationException("The selected window has an unsupported capture size.");

        using (var frame = new Bitmap(width, height, PixelFormat.Format24bppRgb))
        using (var graphics = Graphics.FromImage(frame))
        {
            IntPtr dc = graphics.GetHdc();
            bool captured;
            try { captured = PrintWindow(handle, dc, 2); } // PW_RENDERFULLCONTENT
            finally { graphics.ReleaseHdc(dc); }
            if (!captured) throw new InvalidOperationException("This application did not provide a screenshot.");

            double scale = Math.Min(1.0, Math.Min(1440.0 / crop.Width, 1080.0 / crop.Height));
            int imageWidth = Math.Max(1, (int)Math.Round(crop.Width * scale));
            int imageHeight = Math.Max(1, (int)Math.Round(crop.Height * scale));
            using (var image = new Bitmap(imageWidth, imageHeight, PixelFormat.Format24bppRgb))
            using (var resized = Graphics.FromImage(image))
            using (var output = new MemoryStream())
            {
                resized.DrawImage(frame, new Rectangle(0, 0, imageWidth, imageHeight), crop, GraphicsUnit.Pixel);
                image.Save(output, ImageFormat.Jpeg);
                return new { window = window, image = Convert.ToBase64String(output.ToArray()), imageWidth = imageWidth, imageHeight = imageHeight };
            }
        }
    }

    private static Input PointerMove(IntPtr handle, Point point)
    {
        if (GetAncestor(WindowFromPoint(point), 2) != handle)
            throw new InvalidOperationException("The pointer target is outside the selected window or covered by another window.");
        // Insert the absolute move and the click/wheel in the same SendInput batch.
        // Use pixel centers on the virtual desktop, including monitors left of the primary display.
        int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
        if (width < 1 || height < 1) throw new InvalidOperationException("The desktop has no active display.");
        int x = (int)((point.X - GetSystemMetrics(76) + 0.5) * 65536 / width);
        int y = (int)((point.Y - GetSystemMetrics(77) + 0.5) * 65536 / height);
        if (x < 0 || x > 65535 || y < 0 || y > 65535) throw new InvalidOperationException("The target is outside the virtual desktop.");
        return Mouse(0xc001, 0, x, y);
    }

    private static Input Mouse(uint flags, int data = 0, int x = 0, int y = 0)
    {
        return new Input { Data = new InputData { Mouse = new MouseInput { Flags = flags, Data = data, X = x, Y = y } } };
    }

    private static Input Key(ushort key, ushort scan, uint flags)
    {
        return new Input { Type = 1, Data = new InputData { Key = new KeyInput { Key = key, Scan = scan, Flags = flags } } };
    }

    private static void AddChord(List<Input> inputs, ushort[] keys)
    {
        foreach (ushort key in keys) inputs.Add(Key(key, 0, key >= 0x21 && key <= 0x2e ? 1u : 0u));
        for (int index = keys.Length - 1; index >= 0; index--)
        {
            ushort key = keys[index];
            inputs.Add(Key(key, 0, key >= 0x21 && key <= 0x2e ? 3u : 2u));
        }
    }

    private static void Send(IntPtr handle, Input[] inputs)
    {
        RequireForeground(handle);
        foreach (int key in new[] { 0x01, 0x02, 0x04, 0x10, 0x11, 0x12, 0x5b, 0x5c })
            if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("Release held mouse buttons and modifier keys before continuing.");
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length)
            throw new InvalidOperationException("Windows did not accept all input events. Check the selected window before retrying.");
    }
}
