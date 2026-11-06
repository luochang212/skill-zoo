# Repo Zip Download

## Purpose

定义从 GitHub 下载仓库 ZIP 时缓存临时文件的写入契约：并发下载同一仓库必须互不干扰，缓存中最终必须保留完整归档。

## Requirements

### Requirement: 下载临时文件路径唯一

同一仓库的并发下载 MUST 使用互不相同的临时文件路径；任一并发调用不得截断或覆盖另一个正在写入的临时文件。

#### Scenario: 并发下载同一仓库互不干扰
- **WHEN** 两个并发下载任务同时下载同一 owner/repo/branch
- **THEN** 二者写入不同的临时文件，各自的完整内容均被保留，且任一方均不因对方而报错

#### Scenario: 并发下载的临时路径不同
- **WHEN** 连续或并发发起多次对同一仓库的下载
- **THEN** 每次调用使用的临时文件路径彼此不同

### Requirement: 最终缓存条目是完整归档

下载完成后，缓存路径 MUST 保存完整可用的 zip 归档（并发场景下，后完成的写入覆盖先完成的，二者内容一致故最终为完整文件）。

#### Scenario: 并发完成后缓存仍可打开
- **WHEN** 并发下载完成后，用 zip 库打开缓存文件
- **THEN** 缓存文件是有效 zip 归档，可正常读取条目

### Requirement: Unsuccessful downloads clean up their temporary files

The system SHALL automatically attempt to remove a download's temporary file when downloading or cache publication returns an error, or the download future is dropped. An incomplete download SHALL NOT be published as the completed cache entry. Cleanup SHALL affect only the current download's temporary file.

#### Scenario: Response fails after partial data

- **WHEN** a successful HTTP response writes partial data and its body stream then fails
- **THEN** the operation fails, removes its temporary file, and publishes no incomplete cache entry

#### Scenario: Cache publication fails

- **WHEN** a complete response cannot be published at the cache destination
- **THEN** the operation fails and removes its temporary file

#### Scenario: Download is cancelled

- **WHEN** the download future is dropped after creating its temporary file
- **THEN** its temporary file is removed without affecting another in-flight download
