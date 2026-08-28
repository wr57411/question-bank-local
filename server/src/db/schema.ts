import db, { ensureColumn } from './connection.js';

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3B82F6',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_image_url TEXT,
        answer_image_url TEXT,
        layout_type INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS question_tags (
        question_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (question_id, tag_id),
        FOREIGN KEY (question_id) REFERENCES questions(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS similar_question_links (
        question_id TEXT NOT NULL,
        similar_question_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        PRIMARY KEY (question_id, similar_question_id),
        FOREIGN KEY (question_id) REFERENCES questions(id),
        FOREIGN KEY (similar_question_id) REFERENCES questions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS paper_questions (
        paper_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        order_num INTEGER DEFAULT 0,
        PRIMARY KEY (paper_id, question_id),
        FOREIGN KEY (paper_id) REFERENCES papers(id),
        FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
    CREATE INDEX IF NOT EXISTS idx_questions_user ON questions(user_id);
    CREATE INDEX IF NOT EXISTS idx_papers_user ON papers(user_id);
    CREATE INDEX IF NOT EXISTS idx_similar_links_user ON similar_question_links(user_id);

    CREATE TABLE IF NOT EXISTS app_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_name TEXT NOT NULL,
        version_code INTEGER NOT NULL UNIQUE,
        apk_filename TEXT NOT NULL,
        apk_size INTEGER DEFAULT 0,
        release_notes TEXT DEFAULT '',
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft','published')),
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        settings TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS topic_questions (
        topic_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        order_num INTEGER DEFAULT 0,
        teacher_comment TEXT DEFAULT '',
        PRIMARY KEY (topic_id, question_id),
        FOREIGN KEY (topic_id) REFERENCES topics(id),
        FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    CREATE TABLE IF NOT EXISTS question_notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        note_image_url TEXT DEFAULT '',
        label TEXT DEFAULT '',
        text_note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS teaching_nodes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        chapter TEXT DEFAULT '',
        subject TEXT DEFAULT '物理',
        name TEXT NOT NULL,
        difficulty TEXT DEFAULT '基础',
        key_concept TEXT DEFAULT '',
        diagram TEXT DEFAULT '',
        current_version_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS teaching_versions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        version_num INTEGER DEFAULT 1,
        model_name TEXT DEFAULT '',
        status TEXT DEFAULT 'PENDING',
        content_markdown TEXT DEFAULT '',
        content_json TEXT,
        drawings TEXT DEFAULT '{}',
        error_msg TEXT,
        retry_count INTEGER DEFAULT 0,
        is_current INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (node_id) REFERENCES teaching_nodes(id)
    );

    CREATE TABLE IF NOT EXISTS node_questions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (node_id) REFERENCES teaching_nodes(id)
    );
`);

ensureColumn('questions', 'user_comment', "TEXT DEFAULT ''");
ensureColumn('questions', 'semantic_summary', "TEXT DEFAULT ''");
ensureColumn('questions', 'ai_metadata', "TEXT DEFAULT '{}'");
ensureColumn('users', 'pending_link_list', "TEXT DEFAULT '[]'");
ensureColumn('questions', 'versions', "TEXT DEFAULT '[]'");
ensureColumn('questions', 'purged_at', 'TEXT');
ensureColumn('questions', 'book_name', "TEXT DEFAULT ''");
ensureColumn('questions', 'page_number', "TEXT DEFAULT ''");
ensureColumn('questions', 'question_number', "TEXT DEFAULT ''");

db.exec(`
    CREATE TABLE IF NOT EXISTS pdf_books (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pdf_chapters (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (book_id) REFERENCES pdf_books(id)
    );

    CREATE TABLE IF NOT EXISTS pdf_topics (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pdf_docs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        page_count INTEGER DEFAULT 0,
        file_size INTEGER DEFAULT 0,
        server_path TEXT NOT NULL,
        chapter_id TEXT,
        topic_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pdf_doc_tags (
        pdf_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (pdf_id, tag_id),
        FOREIGN KEY (pdf_id) REFERENCES pdf_docs(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_books_user ON pdf_books(user_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_chapters_user ON pdf_chapters(user_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_topics_user ON pdf_topics(user_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_docs_user ON pdf_docs(user_id);

    CREATE TABLE IF NOT EXISTS pdf_categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        level INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_categories_user ON pdf_categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_categories_parent ON pdf_categories(parent_id);
`);

ensureColumn('pdf_docs', 'category_id', 'TEXT');
ensureColumn('pdf_topics', 'parent_id', 'TEXT');
ensureColumn('pdf_topics', 'sort_order', 'INTEGER DEFAULT 0');

