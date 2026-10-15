package lockfile
import("testing";"os";"path/filepath";"encoding/json")
func TestConvergenceCarrier(t *testing.T){
 home:=t.TempDir();t.Setenv("HOME",home);t.Setenv("USERPROFILE",home);p:=filepath.Join(home,".agents",".skill-lock.json");os.MkdirAll(filepath.Dir(p),0755)
 os.WriteFile(p,[]byte(`{"version":3,"skills":{"demo":{"source":"old/repo","sourceType":"github","sourceUrl":"https://github.com/old/repo","skillPath":"skills/demo","skillFolderHash":"c5ce9b42359d2e38349fd76460f801efb2587b04","commitSha":"same","ref":"dev","installedAt":"old"}}}`),0644)
 if e:=RecordInstall("github.com","other","new","repo","skills/other/SKILL.md","other-tree","");e!=nil{t.Fatal(e)}
 b,_:=os.ReadFile(p);var j map[string]interface{};json.Unmarshal(b,&j);demo:=j["skills"].(map[string]interface{})["demo"].(map[string]interface{});t.Logf("unrelated install: %+v",demo);if demo["skillFolderHash"]!="c5ce9b42359d2e38349fd76460f801efb2587b04"{t.Fatal("hash lost")};if _,ok:=demo["commitSha"];ok{t.Fatal("expected strip")}
 if e:=RecordInstall("github.com","demo","foreign","repo","elsewhere/SKILL.md","foreign-tree","v2");e!=nil{t.Fatal(e)};b,_=os.ReadFile(p);json.Unmarshal(b,&j);t.Logf("same-name install: %+v",j["skills"].(map[string]interface{})["demo"])
}
