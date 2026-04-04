## [2026-04-04] Task: Update proxy.md Documentation

### Changes Made
- Added new section '内置提供商支持' after '常用提供商配置示例'
- Documented built-in providers from opencode auth login
- Explained limit calculation priority order (3 levels)
- Included example configuration using openai and azure providers

### Documentation Structure
- Maintains existing Chinese language and formatting
- Uses same heading hierarchy (### for subsections)
- Includes practical examples with code blocks
- Clear explanation of priority order with numbered list

### Key Points Covered
1. What are built-in providers (auth.json vs opencode.json)
2. How to use them (simplified config example)
3. Limit priority: opencode.json > models.dev API > Infinity
4. Benefits: flexibility + convenience
