package lockfile
import("testing";"os";"encoding/json")
func TestReviewDesktopRoundTrip(t *testing.T){
 data,e:=os.ReadFile("/Users/alex/Documents/GitHub/skill-zoo/fixtures/local-protocol/lock-v3-full.json");if e!=nil{t.Fatal(e)}
 f,e:=os.CreateTemp(t.TempDir(),"lock");if e!=nil{t.Fatal(e)};defer f.Close();f.Write(data)
 lf,e:=readFrom(f);if e!=nil{t.Fatal(e)}
 // A disjoint install does not touch the existing entry, but rewrites the whole file.
 lf.Skills["unrelated"]=entry{Source:"cli/cli",SourceType:"github"}
 if e=writeTo(f,lf);e!=nil{t.Fatal(e)}
 f.Seek(0,0);var out map[string]any;json.NewDecoder(f).Decode(&out)
 demo:=out["skills"].(map[string]any)["demo"].(map[string]any)
 t.Logf("existing desktop entry after gh write: %+v",demo)
 if _,ok:=demo["ref"];ok{t.Fatal("expected ref to be dropped")};if _,ok:=demo["commitSha"];ok{t.Fatal("expected commitSha to be dropped")}
}
func TestReviewFutureVersionRead(t *testing.T){
 data,e:=os.ReadFile("/Users/alex/Documents/GitHub/skill-zoo/fixtures/local-protocol/lock-v4-future.json");if e!=nil{t.Fatal(e)}
 f,e:=os.CreateTemp(t.TempDir(),"future");if e!=nil{t.Fatal(e)};defer f.Close();f.Write(data)
 lf,e:=readFrom(f);if e!=nil{t.Fatal(e)};t.Logf("future version read: version=%d, skills=%d",lf.Version,len(lf.Skills));if lf.Version!=3||len(lf.Skills)!=0{t.Fatal("expected fresh v3 state")}
}
