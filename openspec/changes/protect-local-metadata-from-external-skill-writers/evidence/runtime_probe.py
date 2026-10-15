from pathlib import Path
import subprocess,json,tempfile
root=Path(tempfile.mkdtemp(prefix='runtime-',dir='/tmp/gh-skill-review.mM0tji'))
src=root/'source/skills/demo';src.mkdir(parents=True)
original='---\nname: demo\ndescription: Isolated review fixture\n---\nOriginal source body\n'
(src/'SKILL.md').write_text(original)
(src/'script.sh').write_text('#!/bin/sh\necho demo\n');(src/'script.sh').chmod(0o755)
base=root/'agent';base.mkdir();target=root/'ssot/demo';target.mkdir(parents=True)
(target/'SKILL.md').write_text('old content');(target/'stale.txt').write_text('stale');(base/'demo').symlink_to(target,target_is_directory=True)
gh='/tmp/gh-skill-review.mM0tji/bin/gh_2.102.0_macOS_arm64/bin/gh'
def run(args):
 p=subprocess.run([gh,'skill',*args],cwd=root,capture_output=True,text=True)
 print(json.dumps({'args':args,'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr},ensure_ascii=False));return p
assert run(['install',str(root/'source'),'demo','--from-local','--dir',str(base)]).returncode==1
assert run(['install',str(root/'source'),'demo','--from-local','--dir',str(base),'--force']).returncode==0
assert json.loads(run(['list','--dir',str(base),'--json','skillName,path,sourceURL']).stdout)==[]
assert len(json.loads(run(['list','--dir',str(root/'ssot'),'--json','skillName,path,sourceURL']).stdout))==1
assert (base/'demo').is_symlink();assert 'local-path' in (target/'SKILL.md').read_text()
assert (src/'SKILL.md').read_text()==original;assert (target/'stale.txt').exists();assert (target/'script.sh').stat().st_mode&0o777==0o644
print('PASS: symlink retained; target rewritten; source unchanged; stale retained; 0755 script copied as 0644')
