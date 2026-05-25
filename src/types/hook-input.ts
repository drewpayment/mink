export interface PreToolUseInput {
  tool_name: string;
  tool_input: {
    file_path?: string;
    // Write tool
    content?: string;
    // Edit tool
    old_string?: string;
    new_string?: string;
  };
}

export interface PostToolUseInput {
  tool_name: string;
  tool_input: {
    file_path?: string;
    // Write tool
    content?: string;
    // Edit tool
    old_string?: string;
    new_string?: string;
  };
  // Legacy / older hook payload shape — kept for backward compatibility.
  tool_output?: {
    content?: string;
    [key: string]: unknown;
  };
  // Current Claude Code PostToolUse shape (>= 0.x). The Read tool delivers
  // file content nested under `tool_response`; the exact field depends on
  // the tool. We accept several common shapes opportunistically.
  tool_response?: {
    content?: string | Array<{ type?: string; text?: string }>;
    file?: { content?: string };
    text?: string;
    [key: string]: unknown;
  };
}
