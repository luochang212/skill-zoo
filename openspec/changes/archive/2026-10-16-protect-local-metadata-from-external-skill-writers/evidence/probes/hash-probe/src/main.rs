use std::path::{Path,PathBuf};
#[derive(Debug)] enum AppError { Io(std::io::Error), Cli(String) }
impl From<std::io::Error> for AppError {fn from(e:std::io::Error)->Self { Self::Io(e) }}
mod config {pub const SKIP_DIRS: &[&str] = &["node_modules", ".git", "dist", "build", "__pycache__"];}
fn is_symlink_or_junction(p:&Path)->bool {std::fs::symlink_metadata(p).map(|m|m.is_symlink()).unwrap_or(false)}
struct CliService;
impl CliService {
    fn copy_dir_contents(src: &PathBuf, dest: &PathBuf) -> Result<(), AppError> {
        Self::copy_dir_contents_at_depth(src, dest, 0)
    }

    const MAX_COPY_DEPTH: usize = 20;

    fn copy_dir_contents_at_depth(
        src: &PathBuf,
        dest: &PathBuf,
        depth: usize,
    ) -> Result<(), AppError> {
        if depth > Self::MAX_COPY_DEPTH {
            return Err(AppError::Cli(format!(
                "Skill directory is nested deeper than {} levels; refusing to copy",
                Self::MAX_COPY_DEPTH
            )));
        }

        std::fs::create_dir_all(dest).map_err(AppError::Io)?;

        let entries = std::fs::read_dir(src).map_err(AppError::Io)?;

        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if crate::config::SKIP_DIRS.contains(&file_name) {
                continue;
            }

            let dest_path = dest.join(file_name);

            if is_symlink_or_junction(&path) {
                // Never follow directory symlinks (external dirs, loops,
                // escapes) — they are skipped entirely. File symlinks are
                // dereferenced against the link's own directory, never the
                // process CWD.
                let Ok(target) = std::fs::read_link(&path) else {
                    continue;
                };
                let resolved = if target.is_absolute() {
                    target
                } else {
                    path.parent().unwrap_or(Path::new(".")).join(&target)
                };
                if std::fs::symlink_metadata(&resolved)
                    .map(|m| m.is_file())
                    .unwrap_or(false)
                {
                    std::fs::copy(&resolved, &dest_path).map_err(AppError::Io)?;
                }
            } else if path.is_dir() {
                Self::copy_dir_contents_at_depth(&path, &dest_path, depth + 1)?;
            } else {
                std::fs::copy(&path, &dest_path).map_err(AppError::Io)?;
            }
        }

        Ok(())
    }

}
fn main() {let a:Vec<String>=std::env::args().collect();let mut z=zip::ZipArchive::new(std::fs::File::open(&a[1]).unwrap()).unwrap();z.extract(&a[2]).unwrap(); CliService::copy_dir_contents(&PathBuf::from(&a[2]),&PathBuf::from(&a[3])).unwrap();}
