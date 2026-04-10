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
  tool_output?: {
    content?: string;
    [key: string]: unknown;
  };
}
