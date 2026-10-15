# Skyline's ears: Windows' own offline speech recognizer (no audio leaves the PC).
# Talks to the app over stdin/stdout, one line per message.
#   in:  listen | cancel | wake 1|0 | names <json array of app/game/song names> | wav <path> | quit
#   out: {"t":"ready"} {"t":"level","v":0..100} {"t":"hear","text":...} {"t":"heard","text":...,"conf":0..1}
#        {"t":"done","why":"silence|cancel|nomatch"} {"t":"wake"} {"t":"error","msg":...}
# It exits when its input closes, i.e. when Skyline exits.

$CS = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Recognition;
using System.Text;
using System.Threading;

namespace SkyVoice {
  public class Ears {
    SpeechRecognitionEngine eng;
    readonly object outLock = new object();
    bool listening, waking, wakeWanted;
    int suppress;   // completions to swallow (a listen we cancelled to start another)
    long lastLevel;
    string[] names = new string[0];
    CultureInfo culture;

    static string J(string s) {
      var b = new StringBuilder("\"");
      foreach (char c in s ?? "") {
        if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
        else if (c < 32) b.Append(' ');
        else b.Append(c);
      }
      return b.Append('"').ToString();
    }
    void Out(string json) { lock (outLock) { Console.Out.WriteLine(json); Console.Out.Flush(); } }

    public void Start() {
      RecognizerInfo pick = null;
      foreach (var r in SpeechRecognitionEngine.InstalledRecognizers()) {
        if (pick == null) pick = r;
        if (r.Culture.Name == "en-US") { pick = r; break; }
        if (r.Culture.TwoLetterISOLanguageName == "en" && pick.Culture.TwoLetterISOLanguageName != "en") pick = r;
      }
      if (pick == null) throw new Exception("No Windows speech recognizer is installed. Add one in Windows Settings > Time & language > Speech.");
      culture = pick.Culture;
      eng = new SpeechRecognitionEngine(pick);
      eng.InitialSilenceTimeout = TimeSpan.FromSeconds(6);
      eng.EndSilenceTimeout = TimeSpan.FromSeconds(0.7);
      eng.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(1.1);
      eng.BabbleTimeout = TimeSpan.FromSeconds(12);
      eng.AudioLevelUpdated += (s, e) => {
        if (!listening) return;
        long now = DateTime.UtcNow.Ticks;
        if (now - lastLevel < 450000) return;   // ~20 a second
        lastLevel = now;
        Out("{\"t\":\"level\",\"v\":" + e.AudioLevel + "}");
      };
      eng.SpeechHypothesized += (s, e) => { if (listening) Out("{\"t\":\"hear\",\"text\":" + J(e.Result.Text) + "}"); };
      eng.SpeechRecognized += (s, e) => {
        if (waking) {
          if (e.Result.Grammar.Name == "wake" && e.Result.Confidence > 0.72) Out("{\"t\":\"wake\"}");
          return;
        }
        Out("{\"t\":\"heard\",\"text\":" + J(e.Result.Text) + ",\"conf\":" + e.Result.Confidence.ToString("0.000", CultureInfo.InvariantCulture) + ",\"g\":" + J(e.Result.Grammar.Name) + "}");
      };
      eng.SpeechRecognitionRejected += (s, e) => {
        if (waking || !listening) return;
        string best = e.Result != null && e.Result.Alternates.Count > 0 ? e.Result.Alternates[0].Text : "";
        Out("{\"t\":\"rejected\",\"text\":" + J(best) + "}");
      };
      eng.RecognizeCompleted += (s, e) => {
        if (suppress > 0) { suppress--; return; }
        bool was = listening; listening = false;
        string why = e.Cancelled ? "cancel" : e.InitialSilenceTimeout || e.BabbleTimeout ? "silence" : e.Result == null ? "nomatch" : "ok";
        if (e.Error != null) Out("{\"t\":\"error\",\"msg\":" + J(e.Error.Message) + "}");
        if (was) Out("{\"t\":\"done\",\"why\":\"" + why + "\"}");
        waking = false;
        if (wakeWanted) new Thread(() => { Thread.Sleep(250); StartWake(); }) { IsBackground = true }.Start();
      };
      Load(false);
      try { eng.SetInputToDefaultAudioDevice(); }
      catch (Exception ex) { Out("{\"t\":\"error\",\"msg\":" + J("No microphone: " + ex.Message) + "}"); }
      Out("{\"t\":\"ready\",\"lang\":" + J(culture.Name) + "}");
    }

    void Load(bool wakeOnly) {
      eng.UnloadAllGrammars();
      if (wakeOnly) {
        var wb = new GrammarBuilder(new Choices("hey sky", "okay sky", "hi sky", "hey skyline", "okay skyline", "skyline")) { Culture = culture };
        eng.LoadGrammar(new Grammar(wb) { Name = "wake" });
        return;
      }
      // Commands with the exact names of your apps, games and songs: far more accurate than free dictation.
      var verbs = new Choices("open", "launch", "start", "run", "play", "put on", "close", "switch to", "go to", "show", "show me");
      if (names.Length > 0) {
        var gb = new GrammarBuilder { Culture = culture };
        gb.Append(new GrammarBuilder(new Choices("hey sky", "sky", "hey skyline", "skyline")), 0, 1);
        gb.Append(verbs);
        gb.Append(new Choices(names));
        eng.LoadGrammar(new Grammar(gb) { Name = "names", Weight = 1f, Priority = 2 });
        // "remember that I use Modrinth App for Minecraft" / "when I say Minecraft open Modrinth App"
        var rb = new GrammarBuilder { Culture = culture };
        rb.Append(new GrammarBuilder(new Choices("hey sky", "sky", "hey skyline", "skyline")), 0, 1);
        rb.Append(new Choices("remember", "remember that", "note that"));
        rb.Append(new Choices("I use", "I always use", "use", "I play with", "I prefer"));
        rb.Append(new Choices(names));
        rb.Append(new Choices("for", "instead of", "not", "to play", "when I say", "rather than"));
        rb.Append(new GrammarBuilder(new Choices("the normal", "the regular", "the default", "the")), 0, 1);
        rb.Append(new Choices(names));
        rb.Append(new GrammarBuilder(new Choices("launcher", "app")), 0, 1);
        eng.LoadGrammar(new Grammar(rb) { Name = "remember", Weight = 1f, Priority = 3 });
        var wb2 = new GrammarBuilder { Culture = culture };
        wb2.Append(new GrammarBuilder(new Choices("remember", "remember that")), 0, 1);
        wb2.Append("when I say");
        wb2.Append(new Choices(names));
        wb2.Append(new Choices("open", "launch", "start", "play", "I mean"));
        wb2.Append(new Choices(names));
        eng.LoadGrammar(new Grammar(wb2) { Name = "remember", Weight = 1f, Priority = 3 });
      }
      var fixedCmds = new Choices("pause", "pause the music", "stop the music", "play", "resume", "play music", "next", "next song", "skip", "skip this song",
        "previous", "previous song", "go back", "volume up", "volume down", "turn it up", "turn it down", "mute", "unmute", "what's playing", "what song is this",
        "what time is it", "what's the weather", "how's the weather", "go home", "open settings", "open games", "open music", "ambient mode", "exit ambient mode",
        "never mind", "cancel", "shuffle", "what do you remember", "start a focus timer", "stop the timer");
      var fb = new GrammarBuilder { Culture = culture };
      fb.Append(new GrammarBuilder(new Choices("hey sky", "sky", "hey skyline", "skyline")), 0, 1);
      fb.Append(fixedCmds);
      eng.LoadGrammar(new Grammar(fb) { Name = "fixed", Weight = 1f, Priority = 2 });
      var dict = new DictationGrammar { Name = "dictation", Weight = 0.6f, Priority = 0 };
      eng.LoadGrammar(dict);
    }

    public void StartWake() {
      try {
        if (listening || !wakeWanted) return;
        waking = true; Load(true); eng.RecognizeAsync(RecognizeMode.Multiple);
      } catch (Exception ex) { waking = false; Out("{\"t\":\"error\",\"msg\":" + J(ex.Message) + "}"); }
    }

    public void Command(string line) {
      try {
        string cmd = line, arg = "";
        int sp = line.IndexOf(' '); if (sp > 0) { cmd = line.Substring(0, sp); arg = line.Substring(sp + 1); }
        if (cmd == "listen" || cmd == "wav") {
          if (waking) { waking = false; eng.RecognizeAsyncCancel(); WaitIdle(); }
          if (listening) { if (cmd == "listen") return; suppress++; eng.RecognizeAsyncCancel(); WaitIdle(); listening = false; }
          Load(false);
          if (cmd == "wav") eng.SetInputToWaveFile(arg); else eng.SetInputToDefaultAudioDevice();
          listening = true;
          eng.RecognizeAsync(RecognizeMode.Single);
        } else if (cmd == "cancel") {
          if (listening) eng.RecognizeAsyncCancel();
        } else if (cmd == "wake") {
          wakeWanted = arg == "1";
          if (wakeWanted && !listening) StartWake();
          if (!wakeWanted && waking) { eng.RecognizeAsyncCancel(); }
        } else if (cmd == "names") {
          var list = new List<string>();
          foreach (var part in arg.Split('\u001f')) { var n = part.Trim(); if (n.Length > 1 && n.Length < 60 && !list.Contains(n)) list.Add(n); }
          names = list.ToArray();
          Out("{\"t\":\"names\",\"n\":" + names.Length + "}");
        }
      } catch (Exception ex) { listening = false; Out("{\"t\":\"error\",\"msg\":" + J(ex.Message) + "}"); }
    }
    void WaitIdle() { for (int i = 0; i < 40 && eng.AudioState != AudioState.Stopped; i++) Thread.Sleep(25); Thread.Sleep(60); }
  }
}
'@

$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $sha = [Security.Cryptography.SHA1]::Create()
  $tag = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($CS))).Replace('-', '').Substring(0, 12)
  $dll = Join-Path $PSScriptRoot "SkyVoice-$tag.dll"
  if (-not (Test-Path $dll)) {
    Get-ChildItem -Path $PSScriptRoot -Filter 'SkyVoice-*.dll' | Remove-Item -Force -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $CS -Language CSharp -ReferencedAssemblies System.Speech -OutputAssembly $dll -OutputType Library
  }
  Add-Type -Path $dll
  $ears = New-Object SkyVoice.Ears
  $ears.Start()
} catch {
  $m = ($_.Exception.Message -replace '[\\"]', "'" -replace '\s+', ' ')
  [Console]::Out.WriteLine('{"t":"error","fatal":true,"msg":"' + $m + '"}')
  exit 1
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'quit') { break }
  $line = $line.Trim()
  if ($line) { $ears.Command($line) }
}
