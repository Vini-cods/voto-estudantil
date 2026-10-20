// Urna Estudantil: local, offline aggregate vote storage. No individual ballot is persisted.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Diagnostics;

internal static class Program
{
    private const int BodyLimit = 12 * 1024 * 1024;
    private static readonly object Gate = new object();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 24 * 1024 * 1024, RecursionLimit = 60 };
    private static readonly string[] Choices = { "c1", "c2", "c3", "blank", "nullVote" };
    private static readonly string[] RequiredAssets = { "index.html", "app.js", "style.css", "favicon.svg", "assets/gresp.png", "assets/simbolo-institucional.png", "assets/chapa-01-grupo.jpeg", "assets/chapa-07-grupo.jpeg", "assets/chapa-10-grupo.jpeg" };
    private static readonly Dictionary<string, DateTime> AdminSessions = new Dictionary<string, DateTime>();
    private static readonly Dictionary<string, Voter> Voters = new Dictionary<string, Voter>();
    private static Dictionary<string, object> State;
    private static string DataDir, WebDir, StatePath, Csrf, BaseUrl;
    private static int Port;
    private static FileStream InstanceLock;
    private static TcpListener Listener;

    private sealed class Voter { public string Name, Grade; public DateTime Expires; }
    private sealed class ApiError : Exception { public readonly int Code; public ApiError(int code, string message) : base(message) { Code = code; } }
    private sealed class Request { public string Method, Path, Target; public byte[] Body; public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); }
    private sealed class Reply { public int Code = 200; public string Type = "application/json; charset=utf-8", FileName; public byte[] Data; }

    private static int Main(string[] args)
    {
        try
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            DataDir = Path.Combine(exeDir, "Dados"); WebDir = null;
            bool browser = true; int requestedPort = 0;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--no-browser") browser = false;
                else if (args[i] == "--data-dir" && i + 1 < args.Length) DataDir = args[++i];
                else if (args[i] == "--web-dir" && i + 1 < args.Length) WebDir = args[++i];
                else if (args[i] == "--port" && i + 1 < args.Length) requestedPort = int.Parse(args[++i], CultureInfo.InvariantCulture);
                else throw new Exception("Argumento desconhecido: " + args[i]);
            }
            if (requestedPort < 0 || requestedPort > 65535) throw new Exception("Porta inválida.");
            DataDir = Path.GetFullPath(DataDir); if (WebDir != null) WebDir = Path.GetFullPath(WebDir);
            ValidateWebAssets();
            Directory.CreateDirectory(DataDir); StatePath = Path.Combine(DataDir, "urna.json");
            try { InstanceLock = new FileStream(Path.Combine(DataDir, "urna.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { throw new Exception("Esta urna já está aberta para esta pasta Dados. Feche a outra janela antes de continuar."); }
            if (File.Exists(StatePath))
            {
                try { State = ParseObject(File.ReadAllText(StatePath, Encoding.UTF8)); ValidateStored(State); }
                catch (Exception e) { throw new Exception("O arquivo Dados/urna.json está inválido. Os dados foram preservados. Não apague a pasta; preserve os arquivos e procure a comissão. Detalhe: " + e.Message); }
                if (S(State, "status") == "setup")
                {
                    try
                    {
                        ValidateCandidates(State, true);
                        Dictionary<string, object> next = Clone(State); next["status"] = "open"; next["openedAt"] = Now(); next["electionId"] = ElectionId(next); Save(next);
                    }
                    catch (Exception e) { throw new Exception("Não foi possível abrir a configuração antiga desta urna. Os dados e as chapas existentes foram preservados; não apague a pasta Dados. Detalhe: " + e.Message); }
                }
            }
            else
            {
                if (File.Exists(StatePath + ".bak")) throw new Exception("urna.json está ausente, mas existe urna.json.bak. Os dados foram preservados; restaure a cópia antes de abrir a urna.");
                State = NewState(); Save(State);
            }
            Csrf = RandomToken();
            Listener = new TcpListener(IPAddress.Loopback, requestedPort); Listener.Start(32);
            Port = ((IPEndPoint)Listener.LocalEndpoint).Port;
            BaseUrl = "http://127.0.0.1:" + Port.ToString(CultureInfo.InvariantCulture);
            Console.WriteLine("URNA_URL=" + BaseUrl);
            Console.WriteLine("Urna Estudantil aberta. Mantenha esta janela aberta durante a votação.");
            Console.WriteLine("Dados: " + DataDir);
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs ev) { try { Listener.Stop(); } catch { } };
            if (browser) { try { Process.Start(BaseUrl); } catch { Console.WriteLine("Abra o endereço acima no navegador."); } }
            while (true) { TcpClient client = Listener.AcceptTcpClient(); ThreadPool.QueueUserWorkItem(delegate { Handle(client); }); }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("ERRO: " + e.Message);
            return 1;
        }
        finally { if (InstanceLock != null) InstanceLock.Dispose(); }
    }

    private static Dictionary<string, object> NewState()
    {
        List<object> candidates = new List<object>();
        string[] names = { "Chapa Conexão", "Liderança Jovem", "Renascer" }, numbers = { "01", "07", "10" };
        for (int i = 1; i <= 3; i++) candidates.Add(D("id", "c" + i, "name", names[i - 1], "number", numbers[i - 1], "portrait", "", "groupPhoto", i == 2 ? SeedImage("chapa-07-grupo.jpeg") : "", "proposals", i == 2 ? "Melhorias nos banheiros.\nCriação de um espaço de apoio feminino, com kits de higiene e auxílio da escola.\nDisponibilização mensal de absorventes para situações de emergência.\nCriação de uma rede de apoio para pessoas com deficiência.\nCriação de um espaço de lazer voltado à inclusão e ao estímulo dos alunos.\nRealização de dinâmicas solidárias para arrecadação de roupas." : "", "members", i == 2 ? "Isabelly M — 1º ano D\nSophia Januario — 1º ano D\nMaria Luiza — 1º ano D\nEnzo Antoni — 2º ano B\nGuilherme — 1º ano G\nKauan — 1º ano C\nLayla Santos — 2º ano C\nNycolas Oliveira — 2º ano F" : "", "representativeName", i == 2 ? "Isabelly M — 1º ano D" : ""));
        Dictionary<string, object> conexao = Obj(candidates[0]);
        conexao["groupPhoto"] = SeedImage("chapa-01-grupo.jpeg");
        conexao["representativeName"] = "Julia Oliveira — 2º ano A";
        conexao["members"] = "Julia Oliveira — 2º ano A\nJuan Ferreira — 2º ano A\nAna Julia — 2º ano B\nAna Beatriz — 1º ano B\nZaqueu — 2º ano B\nCaique — 2º ano B\nHadassa Nascimento — 1º ano D\nRyan Dantas — 1º ano C";
        conexao["proposals"] = "Saúde mental e bem-estar.\nFuturo profissional.\nAluno destaque.\nApoio aos alunos.\nMelhorias na escola.\nProjeto ideia do mês.\nCampanha solidária.\nAssembleia dos alunos.";
        Dictionary<string, object> renascer = Obj(candidates[2]);
        renascer["groupPhoto"] = SeedImage("chapa-10-grupo.jpeg");
        renascer["representativeName"] = "Fernanda Santos de Souza — 1º ano D";
        renascer["members"] = "Fernanda Santos de Souza — 1º ano D\nCaylon — 2º ano D\nGuilherme Ferreira — 2º ano D\nGeovana Almeida — 2º ano B\nPyetro — 2º ano D\nPyetro Wilians — 1º ano A\nGustavo — 1º ano A\nKauany Sonya — 2º ano D";
        renascer["proposals"] = "Realização de dois interclasses.\nMúsica três vezes por semana.\nJogos.\nShow de talentos.\nFesta de Halloween.\nBaile de primavera.\nPasseio.\nSemana do adolescente.\nSala destaque.\nTrote em uma sexta-feira por mês.";
        string urnId = Guid.NewGuid().ToString("D"), openedAt = Now();
        Dictionary<string, object> state = D("stateFormat", "urna-estudantil-state-v1", "urnId", urnId, "electionId", "", "urnName", "Urna " + urnId.Substring(0, 8).ToUpperInvariant(), "school", "Araci Zebral Teixeira", "electionTitle", "Eleição do Grêmio Estudantil 2026", "status", "open", "createdAt", openedAt, "openedAt", openedAt, "closedAt", "", "candidates", candidates, "counts", EmptyCounts(), "participants", new List<object>());
        ValidateCandidates(state, true); state["electionId"] = ElectionId(state); return state;
    }
    private static string SeedImage(string name)
    {
        return "data:image/jpeg;base64," + Convert.ToBase64String(ReadWebAsset("assets/" + name));
    }
    private static void ValidateWebAssets()
    {
        foreach (string name in RequiredAssets)
        {
            try { if (ReadWebAsset(name).Length == 0) throw new IOException("Arquivo vazio."); }
            catch (Exception e) { throw new Exception("Interface incompleta: " + name + ". Obtenha ou recompile o executável completo" + (WebDir != null ? " ou confira a pasta indicada por --web-dir" : "") + ". Nenhum dado de votação foi criado ou alterado. Detalhe: " + e.Message); }
        }
    }
    private static byte[] ReadWebAsset(string relative)
    {
        if (String.IsNullOrEmpty(relative) || relative[0] == '/' || relative.IndexOf('\\') >= 0 || relative.IndexOf(':') >= 0 || Regex.IsMatch(relative, @"[\x00-\x1f\x7f]")) throw new ApiError(404, "Arquivo não encontrado.");
        foreach (string segment in relative.Split('/'))
            if (segment.Length == 0 || segment == "." || segment == ".." || segment.EndsWith(".", StringComparison.Ordinal) || segment.EndsWith(" ", StringComparison.Ordinal) || segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new ApiError(404, "Arquivo não encontrado.");
        if (WebDir != null)
        {
            string file = Path.GetFullPath(Path.Combine(WebDir, relative.Replace('/', Path.DirectorySeparatorChar)));
            string prefix = WebDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) throw new ApiError(404, "Arquivo não encontrado.");
            return File.ReadAllBytes(file);
        }
        using (Stream resource = typeof(Program).Assembly.GetManifestResourceStream("UrnaWeb/" + relative))
        {
            if (resource == null) throw new ApiError(404, "Recurso embutido não encontrado.");
            using (MemoryStream output = new MemoryStream()) { resource.CopyTo(output); return output.ToArray(); }
        }
    }
    private static Dictionary<string, object> EmptyCounts() { return D("c1", 0, "c2", 0, "c3", 0, "blank", 0, "nullVote", 0); }
    private static string Now() { return DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture); }
    private static Dictionary<string, object> D(params object[] kv) { Dictionary<string, object> d = new Dictionary<string, object>(); for (int i = 0; i < kv.Length; i += 2) d.Add((string)kv[i], kv[i + 1]); return d; }
    private static Dictionary<string, object> Obj(object o) { Dictionary<string, object> d = o as Dictionary<string, object>; if (d == null) throw new ApiError(400, "Objeto JSON inválido."); return d; }
    private static Dictionary<string, object> ParseObject(string text) { lock (Json) return Obj(Json.DeserializeObject(text)); }
    private static string Serialize(object value) { lock (Json) return Json.Serialize(value); }
    private static Dictionary<string, object> Clone(Dictionary<string, object> d) { return ParseObject(Serialize(d)); }
    private static string S(Dictionary<string, object> d, string key) { object v; return d.TryGetValue(key, out v) && v is string ? (string)v : ""; }
    private static object Get(Dictionary<string, object> d, string key) { object v; return d.TryGetValue(key, out v) ? v : null; }
    private static List<object> List(object value) { IEnumerable e = value as IEnumerable; if (e == null || value is string || value is IDictionary) throw new ApiError(400, "Lista JSON inválida."); List<object> a = new List<object>(); foreach (object x in e) a.Add(x); return a; }
    private static int Integer(object value)
    {
        if (!(value is int) && !(value is long) && !(value is decimal)) throw new ApiError(400, "Contagem inválida: use números inteiros.");
        decimal n = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        if (n < 0 || n > 100000000 || n != decimal.Truncate(n)) throw new ApiError(400, "Contagem fora dos limites.");
        return (int)n;
    }
    private static string Clean(string text, int max)
    {
        string s = Regex.Replace((text ?? "").Normalize(NormalizationForm.FormC).Trim(), @"\s+", " ");
        if (s.Length > max || s.IndexOf('\0') >= 0 || Regex.IsMatch(s, @"[\x00-\x08\x0b\x0c\x0e-\x1f]")) throw new ApiError(400, "Texto muito longo ou inválido.");
        return s;
    }
    private static string ProposalText(string text)
    {
        string s = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Normalize(NormalizationForm.FormC).Trim();
        if (s.Length > 4000 || Regex.IsMatch(s, @"[\x00-\x09\x0b-\x1f\x7f]")) throw new ApiError(400, "As propostas devem ter até 4.000 caracteres e não podem conter controles de texto.");
        return s;
    }
    private static string Identity(string name, string grade)
    {
        return Fold(name) + "\n" + Fold(grade);
    }
    private static string Fold(string s)
    {
        StringBuilder b = new StringBuilder();
        foreach (char c in Clean(s, 200).Normalize(NormalizationForm.FormD)) if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) b.Append(c);
        return b.ToString().ToUpperInvariant();
    }
    private static string RandomToken() { byte[] bytes = new byte[32]; using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes); return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
    private static void Save(Dictionary<string, object> next)
    {
        byte[] bytes = new UTF8Encoding(false).GetBytes(Serialize(next));
        string temp = StatePath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            using (FileStream f = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { f.Write(bytes, 0, bytes.Length); f.Flush(true); }
            // Retaining the immediately preceding vote snapshot would expose the last
            // student's choice by comparing aggregate and presence differences.
            if (File.Exists(StatePath)) File.Replace(temp, StatePath, null, true); else File.Move(temp, StatePath);
            State = next;
        }
        finally { if (File.Exists(temp)) try { File.Delete(temp); } catch { } }
    }
    private static int Total(Dictionary<string, object> state)
    {
        Dictionary<string, object> counts = Obj(state["counts"]); int total = 0;
        foreach (string k in Choices) total = checked(total + Integer(Get(counts, k)));
        if (counts.Count != 5) throw new ApiError(400, "O conjunto de contagens é inválido.");
        return total;
    }
    private static void SortParticipants(List<object> p)
    {
        p.Sort(delegate(object a, object b) { Dictionary<string, object> aa = Obj(a), bb = Obj(b); int n = StringComparer.Ordinal.Compare(Fold(S(aa, "name")), Fold(S(bb, "name"))); return n != 0 ? n : StringComparer.Ordinal.Compare(Fold(S(aa, "grade")), Fold(S(bb, "grade"))); });
    }
    private static void CheckParticipants(Dictionary<string, object> state)
    {
        List<object> people = List(state["participants"]); if (people.Count != Total(state)) throw new ApiError(400, "Total de votos diferente do total de participantes.");
        HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (object person in people)
        {
            Dictionary<string, object> p = Obj(person); string name = Clean(S(p, "name"), 120), grade = Clean(S(p, "grade"), 60);
            if (name.Length < 2 || grade.Length < 1 || p.Count != 2 || !p.ContainsKey("name") || !p.ContainsKey("grade")) throw new ApiError(400, "Participante inválido. O cadastro deve conter somente nome e série.");
            if (!seen.Add(Identity(name, grade))) throw new ApiError(400, "Participante repetido no arquivo da urna.");
        }
    }
    private static void ValidateStored(Dictionary<string, object> s)
    {
        if (S(s, "stateFormat") != "urna-estudantil-state-v1") throw new Exception("Formato de dados desconhecido.");
        Guid parsed; if (!Guid.TryParse(S(s, "urnId"), out parsed)) throw new Exception("Identificação da urna inválida.");
        string status = S(s, "status"); if (status != "setup" && status != "open" && status != "closed") throw new Exception("Situação da urna inválida.");
        CheckParticipants(s); ValidateCandidates(s, status != "setup");
        if (status != "setup" && S(s, "electionId") != ElectionId(s)) throw new Exception("Configuração ou identificação da eleição inválida.");
        if (status == "setup" && Total(s) != 0) throw new Exception("Uma urna em configuração não pode ter votos.");
        if (Get(s, "credentials") != null) { Dictionary<string, object> c = Obj(s["credentials"]); if (Convert.FromBase64String(S(c, "salt")).Length < 16 || Convert.FromBase64String(S(c, "hash")).Length != 32 || Integer(c["iterations"]) < 100000) throw new Exception("Credencial inválida."); }
    }
    private static void ValidateCandidates(Dictionary<string, object> s, bool requireFull)
    {
        List<object> c = List(s["candidates"]); if (c.Count != 3) throw new ApiError(400, "Cadastre exatamente três candidatas.");
        HashSet<string> numbers = new HashSet<string>();
        for (int i = 0; i < 3; i++)
        {
            Dictionary<string, object> candidate = Obj(c[i]); string number = S(candidate, "number"), name = S(candidate, "name");
            ProposalText(S(candidate, "proposals"));
            ProposalText(S(candidate, "members")); Clean(S(candidate, "representativeName"), 120);
            if (S(candidate, "id") != "c" + (i + 1)) throw new ApiError(400, "Identificação das candidatas inválida.");
            if (number.Length > 0 && (!Regex.IsMatch(number, @"^[0-9]{2}$") || !numbers.Add(number))) throw new ApiError(400, "Os números das candidatas devem ter dois algarismos e ser diferentes.");
            if (requireFull && (name.Length < 2 || number.Length != 2)) throw new ApiError(400, "Preencha o nome e o número de cada uma das três candidatas.");
        }
        if (requireFull && (S(s, "school").Length < 2 || S(s, "electionTitle").Length < 2 || S(s, "urnName").Length < 2)) throw new ApiError(400, "Preencha escola, título da eleição e identificação desta urna.");
    }
    private static string ElectionId(Dictionary<string, object> s)
    {
        StringBuilder canonical = new StringBuilder("urna-estudantil-config-v1\n");
        AppendCanonical(canonical, S(s, "school")); AppendCanonical(canonical, S(s, "electionTitle"));
        foreach (object item in List(s["candidates"])) { Dictionary<string, object> c = Obj(item); AppendCanonical(canonical, S(c, "id")); AppendCanonical(canonical, S(c, "name")); AppendCanonical(canonical, S(c, "number")); }
        using (SHA256 hash = SHA256.Create()) { byte[] bytes = hash.ComputeHash(Encoding.UTF8.GetBytes(canonical.ToString())); StringBuilder b = new StringBuilder(); foreach (byte x in bytes) b.Append(x.ToString("x2")); return b.ToString(); }
    }
    private static void AppendCanonical(StringBuilder b, string s) { s = Clean(s, 200); b.Append(s.Length.ToString(CultureInfo.InvariantCulture)).Append(':').Append(s).Append('\n'); }
    private static List<object> DisplayCandidates()
    {
        List<object> candidates = new List<object>();
        foreach (object item in List(State["candidates"])) { Dictionary<string, object> c = Clone(Obj(item)); c["portrait"] = ""; candidates.Add(c); }
        return candidates;
    }
    private static Dictionary<string, object> PublicState()
    {
        return D("urnId", State["urnId"], "electionId", State["electionId"], "urnName", State["urnName"], "school", State["school"], "electionTitle", State["electionTitle"], "status", State["status"], "configured", true, "candidates", DisplayCandidates(), "total", List(State["participants"]).Count, "csrfToken", Csrf);
    }
    private static Dictionary<string, object> AdminState()
    {
        Dictionary<string, object> d = Clone(State); d.Remove("credentials"); d["candidates"] = DisplayCandidates(); d["configured"] = true; d["total"] = Total(State);
        // Live per-choice totals and names together permit differential vote inference.
        if (S(State, "status") == "open") { d.Remove("counts"); d.Remove("participants"); }
        return d;
    }
    private static string NewAdminSession() { string token = RandomToken(); AdminSessions[token] = DateTime.UtcNow.AddHours(8); return token; }
    private static void NeedAdmin(Request r)
    {
        string token; DateTime expiry;
        if (!r.Headers.TryGetValue("X-Admin-Token", out token) || !AdminSessions.TryGetValue(token, out expiry) || expiry < DateTime.UtcNow) throw new ApiError(401, "Reabra o painel de Resultados para continuar.");
        AdminSessions[token] = DateTime.UtcNow.AddHours(8);
    }
    private static void NeedOpen() { if (S(State, "status") != "open") throw new ApiError(409, "A votação não está aberta."); }
    private static Dictionary<string, object> Batch(Dictionary<string, object> s)
    {
        List<object> people = List(s["participants"]); SortParticipants(people);
        List<object> candidates = new List<object>();
        foreach (object item in List(s["candidates"])) { Dictionary<string, object> c = Obj(item); candidates.Add(D("id", c["id"], "name", c["name"], "number", c["number"])); }
        return D("format", "urna-estudantil-v1", "electionId", s["electionId"], "urnId", s["urnId"], "urnName", s["urnName"], "school", s["school"], "electionTitle", s["electionTitle"], "status", s["status"], "openedAt", s["openedAt"], "closedAt", s["closedAt"], "candidates", candidates, "counts", s["counts"], "participants", people, "total", Total(s));
    }

    private static Reply Route(Request r)
    {
        if (r.Path.StartsWith("/api/", StringComparison.Ordinal))
        {
            lock (Gate)
            {
                if (r.Method == "GET" && r.Path == "/api/state") return AsJson(PublicState());
                Dictionary<string, object> body = null;
                if (r.Method == "POST")
                {
                    string csrf; if (!r.Headers.TryGetValue("X-Urna-Token", out csrf) || csrf != Csrf) throw new ApiError(403, "Recarregue a página desta urna e tente novamente.");
                    body = r.Body.Length == 0 ? D() : ParseObject(new UTF8Encoding(false, true).GetString(r.Body));
                }
                if (r.Method == "POST" && r.Path == "/api/admin/access") return AsJson(D("adminToken", NewAdminSession()));
                if (r.Method == "POST" && (r.Path == "/api/admin/setup" || r.Path == "/api/admin/login" || r.Path == "/api/admin/config" || r.Path == "/api/admin/open")) throw new ApiError(409, "Esta urna já vem pronta para votar. Não há senha nem etapa de preparação.");
                if (r.Path.StartsWith("/api/admin/", StringComparison.Ordinal))
                {
                    NeedAdmin(r);
                    if (r.Method == "GET" && r.Path == "/api/admin/state") return AsJson(AdminState());
                    if (r.Method == "POST" && r.Path == "/api/admin/close")
                    {
                        NeedOpen(); Dictionary<string, object> next = Clone(State); next["status"] = "closed"; next["closedAt"] = Now(); Save(next); Voters.Clear(); return AsJson(AdminState());
                    }
                    if (r.Method == "GET" && (r.Path == "/api/admin/export" || r.Path == "/api/admin/report" || r.Path == "/api/admin/participants"))
                    {
                        if (S(State, "status") != "closed") throw new ApiError(409, "Finalize a votação desta urna para exportar os resultados.");
                        if (r.Path == "/api/admin/export") return DownloadJson(Batch(State), "urna-" + S(State, "urnId") + ".json");
                        if (r.Path == "/api/admin/participants") return ParticipantsCsv(State);
                        return ReportCsv(State);
                    }
                    if (r.Method == "GET" && r.Path == "/api/admin/backup")
                    {
                        if (S(State, "status") != "closed") throw new ApiError(409, "Finalize a votação desta urna para exportar os resultados.");
                        return DownloadJson(Batch(State), "copia-urna-" + S(State, "urnId") + ".json");
                    }
                    if (r.Method == "POST" && r.Path == "/api/admin/consolidate") return AsJson(Consolidate(body));
                }
                if (r.Method == "POST" && r.Path == "/api/identify")
                {
                    NeedOpen(); string name = Clean(S(body, "name"), 120), grade = Clean(S(body, "grade"), 60);
                    if (name.Length < 2 || !Regex.IsMatch(name, @"\p{L}") || grade.Length == 0) throw new ApiError(400, "Informe o nome completo e a série do aluno.");
                    string id = Identity(name, grade);
                    foreach (object item in List(State["participants"])) { Dictionary<string, object> p = Obj(item); if (Identity(S(p, "name"), S(p, "grade")) == id) throw new ApiError(409, "Este nome e série já registraram participação nesta urna. Procure a comissão."); }
                    List<string> expired = new List<string>(); foreach (KeyValuePair<string, Voter> pair in Voters) if (pair.Value.Expires < DateTime.UtcNow) expired.Add(pair.Key); foreach (string key in expired) Voters.Remove(key);
                    string token = RandomToken(); Voters[token] = new Voter { Name = name, Grade = grade, Expires = DateTime.UtcNow.AddMinutes(10) }; return AsJson(D("voterToken", token));
                }
                if (r.Method == "POST" && r.Path == "/api/vote")
                {
                    NeedOpen(); string token = S(body, "voterToken"), choice = S(body, "choice"); Voter voter;
                    if (!Voters.TryGetValue(token, out voter) || voter.Expires < DateTime.UtcNow) throw new ApiError(409, "A identificação expirou ou este voto já foi confirmado. Volte ao início.");
                    if (Array.IndexOf(Choices, choice) < 0) throw new ApiError(400, "Opção de voto inválida.");
                    List<object> people = List(State["participants"]); string id = Identity(voter.Name, voter.Grade);
                    foreach (object item in people) { Dictionary<string, object> p = Obj(item); if (Identity(S(p, "name"), S(p, "grade")) == id) { Voters.Remove(token); throw new ApiError(409, "Este aluno já registrou participação nesta urna."); } }
                    Dictionary<string, object> next = Clone(State), counts = Obj(next["counts"]); counts[choice] = checked(Integer(counts[choice]) + 1); people = List(next["participants"]); people.Add(D("name", voter.Name, "grade", voter.Grade)); SortParticipants(people); next["participants"] = people;
                    Save(next); Voters.Remove(token); return AsJson(D("saved", true));
                }
                throw new ApiError(404, "Operação não encontrada.");
            }
        }
        if (r.Method != "GET") throw new ApiError(405, "Método não permitido.");
        string relative = r.Path == "/" ? "index.html" : Uri.UnescapeDataString(r.Path.Substring(1));
        byte[] bytes = ReadWebAsset(relative);
        string extension = Path.GetExtension(relative).ToLowerInvariant();
        string type = extension == ".html" ? "text/html; charset=utf-8" : extension == ".css" ? "text/css; charset=utf-8" : extension == ".js" ? "text/javascript; charset=utf-8" : extension == ".svg" ? "image/svg+xml" : extension == ".png" ? "image/png" : extension == ".jpg" || extension == ".jpeg" ? "image/jpeg" : extension == ".webp" ? "image/webp" : extension == ".json" ? "application/json; charset=utf-8" : extension == ".woff2" ? "font/woff2" : "application/octet-stream";
        if (extension == ".html") bytes = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(bytes).Replace("__CSRF_TOKEN__", Csrf));
        return new Reply { Type = type, Data = bytes };
    }
    private static Dictionary<string, object> Consolidate(Dictionary<string, object> input)
    {
        List<object> batches = List(Get(input, "batches")); if (batches.Count < 1 || batches.Count > 300) throw new ApiError(400, "Selecione de 1 a 300 arquivos de resultados.");
        Dictionary<string, object> first = null, counts = EmptyCounts(); List<object> allPeople = new List<object>(), urns = new List<object>(); HashSet<string> urnIds = new HashSet<string>(), peopleIds = new HashSet<string>();
        foreach (object item in batches)
        {
            Dictionary<string, object> b = Obj(item); if (S(b, "format") != "urna-estudantil-v1" || S(b, "status") != "closed") throw new ApiError(400, "Use somente arquivos JSON de urnas finalizadas.");
            Guid guid; if (!Guid.TryParse(S(b, "urnId"), out guid) || !urnIds.Add(guid.ToString("D"))) throw new ApiError(409, "Há um arquivo repetido da mesma urna. Cada urna deve aparecer apenas uma vez.");
            ValidateCandidates(b, true); if (S(b, "electionId") != ElectionId(b)) throw new ApiError(400, "A configuração de um arquivo não corresponde à identificação da eleição.");
            if (first == null) first = b; else if (S(first, "electionId") != S(b, "electionId")) throw new ApiError(409, "Os arquivos pertencem a eleições ou candidatas diferentes. Use a mesma configuração em todos os notebooks.");
            CheckParticipants(b); int total = Total(b); if (Integer(Get(b, "total")) != total) throw new ApiError(400, "Total declarado incorreto em um arquivo.");
            if (S(b, "openedAt").Length == 0 || S(b, "closedAt").Length == 0) throw new ApiError(400, "Arquivo sem registro de abertura ou fechamento.");
            foreach (object person in List(b["participants"])) { Dictionary<string, object> p = Obj(person); if (!peopleIds.Add(Identity(S(p, "name"), S(p, "grade")))) throw new ApiError(409, "Foi encontrado o mesmo nome e série em mais de uma urna. A soma foi bloqueada; a comissão deve conferir os participantes. O sigilo impede identificar ou excluir o voto desse aluno."); allPeople.Add(D("name", S(p, "name"), "grade", S(p, "grade"))); }
            Dictionary<string, object> local = Obj(b["counts"]); foreach (string choice in Choices) counts[choice] = checked(Integer(counts[choice]) + Integer(local[choice]));
            urns.Add(D("urnId", b["urnId"], "urnName", b["urnName"], "total", total, "closedAt", b["closedAt"]));
        }
        SortParticipants(allPeople);
        return D("format", "urna-estudantil-consolidado-v1", "electionId", first["electionId"], "school", first["school"], "electionTitle", first["electionTitle"], "candidates", first["candidates"], "counts", counts, "total", allPeople.Count, "urns", urns, "participants", allPeople, "duplicateCount", 0);
    }
    private static string Csv(string value) { return "\"" + (value ?? "").Replace("\"", "\"\"") + "\""; }
    private static string CsvSafe(string value) { if (!String.IsNullOrEmpty(value) && "=+-@\t\r".IndexOf(value[0]) >= 0) value = "'" + value; return Csv(value); }
    private static Reply ReportCsv(Dictionary<string, object> s)
    {
        StringBuilder b = new StringBuilder(); b.AppendLine("\"RELATÓRIO DA URNA ESTUDANTIL\""); b.AppendLine("\"Escola\";" + CsvSafe(S(s, "school"))); b.AppendLine("\"Eleição\";" + CsvSafe(S(s, "electionTitle"))); b.AppendLine("\"Urna\";" + CsvSafe(S(s, "urnName"))); b.AppendLine("\"Identificação da urna\";" + Csv(S(s, "urnId"))); b.AppendLine("\"Situação\";\"FINALIZADA\""); b.AppendLine("\"Abertura (UTC)\";" + Csv(S(s, "openedAt"))); b.AppendLine("\"Finalização (UTC)\";" + Csv(S(s, "closedAt"))); b.AppendLine(); b.AppendLine("\"Opção\";\"Número\";\"Votos\"");
        Dictionary<string, object> counts = Obj(s["counts"]);
        foreach (object item in List(s["candidates"])) { Dictionary<string, object> c = Obj(item); b.AppendLine(CsvSafe(S(c, "name")) + ";" + Csv("'" + S(c, "number")) + ";" + Integer(counts[S(c, "id")]).ToString(CultureInfo.InvariantCulture)); }
        b.AppendLine("\"Brancos\";\"\";" + Integer(counts["blank"])); b.AppendLine("\"Nulos\";\"\";" + Integer(counts["nullVote"])); b.AppendLine("\"TOTAL DE VOTOS\";\"\";" + Total(s)); b.AppendLine("\"TOTAL DE PARTICIPANTES\";\"\";" + List(s["participants"]).Count); b.AppendLine("\"Conferência\";\"Votos e participantes conferem\""); b.AppendLine(); b.AppendLine("\"Voto secreto: este relatório não relaciona alunos a escolhas.\"");
        return CsvReply(b.ToString(), "resultado-" + S(s, "urnId") + ".csv");
    }
    private static Reply ParticipantsCsv(Dictionary<string, object> s)
    {
        StringBuilder b = new StringBuilder("\"Nome\";\"Série\"\r\n"); List<object> people = List(s["participants"]); SortParticipants(people); foreach (object item in people) { Dictionary<string, object> p = Obj(item); b.Append(CsvSafe(S(p, "name"))).Append(';').Append(CsvSafe(S(p, "grade"))).Append("\r\n"); } return CsvReply(b.ToString(), "participantes-" + S(s, "urnId") + ".csv");
    }
    private static Reply CsvReply(string content, string file) { byte[] bytes = Encoding.UTF8.GetBytes("\ufeff" + content); return new Reply { Data = bytes, Type = "text/csv; charset=utf-8", FileName = file }; }
    private static Reply AsJson(object data) { return new Reply { Data = Encoding.UTF8.GetBytes(Serialize(data)) }; }
    private static Reply DownloadJson(object data, string file) { Reply r = AsJson(data); r.FileName = file; return r; }

    private static void Handle(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 15000; client.SendTimeout = 15000; client.NoDelay = true; NetworkStream stream = client.GetStream(); Reply reply;
                try { Request request = ReadRequest(stream); CheckRequest(request); reply = Route(request); }
                catch (ApiError e) { reply = AsJson(D("error", e.Message)); reply.Code = e.Code; }
                catch (Exception e) { Console.Error.WriteLine("Falha: " + e.GetType().Name + ": " + e.Message); reply = AsJson(D("error", "Não foi possível concluir a operação. Nenhum voto foi confirmado sem ser salvo. Confira o espaço livre, preserve a pasta Dados e procure a comissão.")); reply.Code = 500; }
                string status = reply.Code == 200 ? "OK" : reply.Code == 400 ? "Bad Request" : reply.Code == 401 ? "Unauthorized" : reply.Code == 403 ? "Forbidden" : reply.Code == 404 ? "Not Found" : reply.Code == 405 ? "Method Not Allowed" : reply.Code == 409 ? "Conflict" : reply.Code == 413 ? "Payload Too Large" : reply.Code == 429 ? "Too Many Requests" : "Internal Server Error";
                string headers = "HTTP/1.1 " + reply.Code + " " + status + "\r\nContent-Type: " + reply.Type + "\r\nContent-Length: " + reply.Data.Length.ToString(CultureInfo.InvariantCulture) + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\r\n";
                if (reply.FileName != null) headers += "Content-Disposition: attachment; filename=\"" + reply.FileName + "\"\r\n";
                byte[] h = Encoding.ASCII.GetBytes(headers + "\r\n"); stream.Write(h, 0, h.Length); stream.Write(reply.Data, 0, reply.Data.Length); stream.Flush();
            }
            catch (IOException) { }
            catch (SocketException) { }
        }
    }
    private static Request ReadRequest(NetworkStream stream)
    {
        MemoryStream header = new MemoryStream(); int matched = 0;
        byte[] ending = { 13, 10, 13, 10 };
        while (matched < 4)
        {
            int b = stream.ReadByte(); if (b < 0) throw new ApiError(400, "Requisição incompleta."); header.WriteByte((byte)b); if (header.Length > 32768) throw new ApiError(400, "Cabeçalho muito grande."); matched = b == ending[matched] ? matched + 1 : b == 13 ? 1 : 0;
        }
        string[] lines = Encoding.ASCII.GetString(header.ToArray()).Split(new string[] { "\r\n" }, StringSplitOptions.None); string[] start = lines[0].Split(' ');
        if (start.Length != 3 || (start[0] != "GET" && start[0] != "POST") || !start[1].StartsWith("/", StringComparison.Ordinal)) throw new ApiError(400, "Requisição inválida.");
        Request request = new Request { Method = start[0], Target = start[1], Path = start[1].Split('?')[0] };
        for (int i = 1; i < lines.Length; i++) { if (lines[i].Length == 0) continue; int colon = lines[i].IndexOf(':'); if (colon <= 0) throw new ApiError(400, "Cabeçalho inválido."); string key = lines[i].Substring(0, colon).Trim(); if (request.Headers.ContainsKey(key)) throw new ApiError(400, "Cabeçalho repetido."); request.Headers[key] = lines[i].Substring(colon + 1).Trim(); }
        if (request.Headers.ContainsKey("Transfer-Encoding")) throw new ApiError(400, "Transferência em blocos não suportada.");
        int length = 0; string size; if (request.Headers.TryGetValue("Content-Length", out size) && (!int.TryParse(size, NumberStyles.None, CultureInfo.InvariantCulture, out length) || length < 0)) throw new ApiError(400, "Tamanho inválido.");
        if (length > BodyLimit) throw new ApiError(413, "Arquivo muito grande. Reduza as imagens ou consolide menos arquivos de cada vez.");
        request.Body = new byte[length]; int read = 0; while (read < length) { int n = stream.Read(request.Body, read, length - read); if (n <= 0) throw new ApiError(400, "Corpo incompleto."); read += n; } return request;
    }
    private static void CheckRequest(Request r)
    {
        string host; if (!r.Headers.TryGetValue("Host", out host) || (host != "127.0.0.1:" + Port && host != "localhost:" + Port)) throw new ApiError(403, "Esta urna aceita somente acesso local.");
        string origin;
        if (r.Headers.TryGetValue("Origin", out origin) && origin != BaseUrl && origin != "http://localhost:" + Port) throw new ApiError(403, "Origem não autorizada.");
        string fetch; if (r.Headers.TryGetValue("Sec-Fetch-Site", out fetch) && fetch != "same-origin" && fetch != "none") throw new ApiError(403, "Abra a urna diretamente neste notebook.");
    }
}
