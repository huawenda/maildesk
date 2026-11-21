/**
 * 迁移列表，索引即 user_version。只追加，不改历史项：
 * 已发布版本的 schema 变更必须新增一条，旧库靠 PRAGMA user_version 依次升级。
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    security TEXT NOT NULL DEFAULT 'tls',
    username TEXT NOT NULL,
    accent TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE folder (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    delimiter TEXT,
    role TEXT,
    uid_validity INTEGER,
    uid_next INTEGER,
    last_synced_uid INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(account_id, path)
  );

  CREATE TABLE message (
    id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
    uid INTEGER NOT NULL,
    message_id TEXT,
    subject TEXT,
    from_name TEXT,
    from_addr TEXT,
    to_json TEXT,
    cc_json TEXT,
    sent_at INTEGER,
    size INTEGER,
    flags_json TEXT,
    is_read INTEGER DEFAULT 0,
    is_flagged INTEGER DEFAULT 0,
    has_html INTEGER DEFAULT 0,
    has_attachments INTEGER DEFAULT 0,
    snippet TEXT,
    body_text TEXT,
    raw_path TEXT,
    UNIQUE(folder_id, uid)
  );
  CREATE INDEX idx_message_list ON message(folder_id, sent_at DESC);

  CREATE VIRTUAL TABLE message_fts USING fts5(
    subject, from_name, from_addr, body_text,
    content='message', content_rowid='rowid', tokenize='unicode61'
  );

  CREATE TRIGGER message_fts_ai AFTER INSERT ON message BEGIN
    INSERT INTO message_fts(rowid, subject, from_name, from_addr, body_text)
    VALUES (new.rowid, new.subject, new.from_name, new.from_addr, new.body_text);
  END;
  CREATE TRIGGER message_fts_ad AFTER DELETE ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, subject, from_name, from_addr, body_text)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_addr, old.body_text);
  END;
  CREATE TRIGGER message_fts_au AFTER UPDATE ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, subject, from_name, from_addr, body_text)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_addr, old.body_text);
    INSERT INTO message_fts(rowid, subject, from_name, from_addr, body_text)
    VALUES (new.rowid, new.subject, new.from_name, new.from_addr, new.body_text);
  END;

  CREATE TABLE attachment (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    filename TEXT,
    mime TEXT,
    size INTEGER,
    content_id TEXT,
    local_path TEXT
  );
  CREATE INDEX idx_attachment_message ON attachment(message_id);

  -- 密码密文单独存，不进 account 表（PRD FR-01.2）
  CREATE TABLE credential (
    account_id TEXT PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    scheme TEXT NOT NULL,
    secret BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX idx_folder_account ON folder(account_id, sort_order);
  `
]
