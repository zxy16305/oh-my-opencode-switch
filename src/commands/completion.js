import { ProfileManager } from '../core/ProfileManager.js';

async function getProfileNames() {
  try {
    const manager = new ProfileManager();
    const profiles = await manager.listProfiles();
    return profiles.map((p) => p.name);
  } catch {
    return [];
  }
}

function generateBashCompletion() {
  return `
_oos_completion() {
  local cur words base
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  words=("\${COMP_WORDS[@]}")

  case \${COMP_CWORD} in
    1)
      COMPREPLY=($(compgen -W "profile template render current validate init completion --help -h --version -v" -- "\${cur}"))
      ;;
    2)
      case "\${words[1]}" in
        profile)
          COMPREPLY=($(compgen -W "list ls create switch use delete rm rename mv copy cp show edit open import export" -- "\${cur}"))
          ;;
        template)
          COMPREPLY=($(compgen -W "list ls create show" -- "\${cur}"))
          ;;
      esac
      ;;
    3)
      case "\${words[1]}" in
        profile)
          case "\${words[2]}" in
            switch|use|delete|rm|show|copy|cp|rename|mv|edit|open|export)
              COMPREPLY=($(compgen -W "$(_oos_get_profiles)" -- "\${cur}"))
              ;;
          esac
          ;;
        template)
          case "\${words[2]}" in
            show)
              COMPREPLY=($(compgen -W "$(_oos_get_profiles)" -- "\${cur}"))
              ;;
          esac
          ;;
      esac
      ;;
    4)
      case "\${words[1]}" in
        profile)
          case "\${words[2]}" in
            copy|cp)
              COMPREPLY=($(compgen -W "$(_oos_get_profiles)" -- "\${cur}"))
              ;;
          esac
          ;;
      esac
      ;;
  esac
}

_oos_get_profiles() {
  oos profile list --json 2>/dev/null | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.map(p=>p.name).join(' '))}catch{}"
}

complete -F _oos_completion oos
`;
}

function generateZshCompletion() {
  return `
#compdef oos

_oos() {
  local context state line
  typeset -A opt_args

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Display help]' \\
    '(-v --version)'{-v,--version}'[Display version]' \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _values 'commands' \\
        'profile[Profile management]' \\
        'template[Template management]' \\
        'render[Render template]' \\
        'current[Show current config]' \\
        'validate[Validate config]' \\
        'init[Initialize OpenCode]' \\
        'completion[Generate shell completion]' \\
        'setup-completion[Install shell completion]' \\
        'models[List available models]'
      ;;
    args)
      case $words[2] in
        profile)
          case $words[3] in
            list|ls|create)
              ;;
            switch|use|delete|rm|show|edit|open|export)
              _values 'profiles' $(_oos_get_profiles_with_desc)
              ;;
            copy|cp|rename|mv)
              if [[ $CURRENT -eq 4 ]]; then
                _values 'profiles' $(_oos_get_profiles_with_desc)
              fi
              ;;
            *)
              _values 'subcommands' \\
                'list[List all profiles]' \\
                'ls[List all profiles]' \\
                'create[Create new profile]' \\
                'switch[Switch to profile]' \\
                'use[Switch to profile]' \\
                'delete[Delete profile]' \\
                'rm[Delete profile]' \\
                'copy[Copy profile]' \\
                'cp[Copy profile]' \\
                'rename[Rename profile]' \\
                'mv[Rename profile]' \\
                'show[Show profile details]' \\
                'edit[Edit profile variables]' \\
                'open[Open profile directory]' \\
                'import[Import profile]' \\
                'export[Export profile]'
              ;;
          esac
          ;;
        template)
          case $words[3] in
            list|ls|create)
              ;;
            show)
              _values 'profiles' $(_oos_get_profiles_with_desc)
              ;;
            *)
              _values 'subcommands' \\
                'list[List templates]' \\
                'ls[List templates]' \\
                'create[Create template]' \\
                'show[Show template]'
              ;;
          esac
          ;;
        render)
          _values 'profiles' $(_oos_get_profiles_with_desc)
          ;;
        completion)
          _values 'shells' bash zsh fish powershell
          ;;
        setup-completion)
          _values 'shells' bash zsh fish powershell
          ;;
      esac
      ;;
  esac
}

_oos_get_profiles_with_desc() {
  local json output
  json=$(oos profile list --json 2>/dev/null)
  if [[ -n "$json" ]]; then
    echo "$json" | node -e "
      const d = require('fs').readFileSync(0, 'utf8');
      try {
        const j = JSON.parse(d);
        j.forEach(p => {
          const desc = p.description || '';
          const active = p.isActive ? ' (active)' : '';
          console.log(p.name + '[' + desc + active + ']');
        });
      } catch {}
    "
  fi
}

_oos
`;
}

function generateFishCompletion() {
  return `
complete -c oos -f

# Top level commands
complete -c oos -n __fish_use_subcommand -a profile -d 'Profile management'
complete -c oos -n __fish_use_subcommand -a template -d 'Template management'
complete -c oos -n __fish_use_subcommand -a render -d 'Render template'
complete -c oos -n __fish_use_subcommand -a current -d 'Show current config'
complete -c oos -n __fish_use_subcommand -a validate -d 'Validate config'
complete -c oos -n __fish_use_subcommand -a init -d 'Initialize OpenCode'
complete -c oos -n __fish_use_subcommand -a completion -d 'Generate shell completion'
complete -c oos -n __fish_use_subcommand -a setup-completion -d 'Install shell completion'
complete -c oos -n __fish_use_subcommand -a models -d 'List available models'

# Profile subcommands
complete -c oos -n '__fish_seen_subcommand_from profile' -a list -d 'List profiles'
complete -c oos -n '__fish_seen_subcommand_from profile' -a ls -d 'List profiles'
complete -c oos -n '__fish_seen_subcommand_from profile' -a create -d 'Create profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a switch -d 'Switch profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a use -d 'Switch profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a delete -d 'Delete profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a rm -d 'Delete profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a copy -d 'Copy profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a cp -d 'Copy profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a rename -d 'Rename profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a mv -d 'Rename profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a show -d 'Show profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a edit -d 'Edit profile variables'
complete -c oos -n '__fish_seen_subcommand_from profile' -a open -d 'Open profile directory'
complete -c oos -n '__fish_seen_subcommand_from profile' -a import -d 'Import profile'
complete -c oos -n '__fish_seen_subcommand_from profile' -a export -d 'Export profile'

# Dynamic profile completion with descriptions
complete -c oos -n '__fish_seen_subcommand_from profile; and __fish_seen_subcommand_from switch use delete rm show edit open export' -a '(oos profile list --json 2>/dev/null | node -e "const d=require(\"fs\").readFileSync(0,\"utf8\");try{const j=JSON.parse(d);j.forEach(p=>{const d=p.description||\"\";const a=p.isActive?\" (active)\":\"\";console.log(p.name+\"\\t\"+d+a)})}catch{}")'
complete -c oos -n '__fish_seen_subcommand_from profile; and __fish_seen_subcommand_from copy cp rename mv' -a '(oos profile list --json 2>/dev/null | node -e "const d=require(\"fs\").readFileSync(0,\"utf8\");try{const j=JSON.parse(d);j.forEach(p=>{const d=p.description||\"\";const a=p.isActive?\" (active)\":\"\";console.log(p.name+\"\\t\"+d+a)})}catch{}")'

# Template subcommands
complete -c oos -n '__fish_seen_subcommand_from template' -a list -d 'List templates'
complete -c oos -n '__fish_seen_subcommand_from template' -a ls -d 'List templates'
complete -c oos -n '__fish_seen_subcommand_from template' -a create -d 'Create template'
complete -c oos -n '__fish_seen_subcommand_from template' -a show -d 'Show template'

complete -c oos -n '__fish_seen_subcommand_from template; and __fish_seen_subcommand_from show' -a '(oos profile list --json 2>/dev/null | node -e "const d=require(\"fs\").readFileSync(0,\"utf8\");try{const j=JSON.parse(d);j.forEach(p=>{const d=p.description||\"\";console.log(p.name+\"\\t\"+d)})}catch{}")'

# Render
complete -c oos -n '__fish_seen_subcommand_from render' -a '(oos profile list --json 2>/dev/null | node -e "const d=require(\"fs\").readFileSync(0,\"utf8\");try{const j=JSON.parse(d);j.forEach(p=>{const d=p.description||\"\";console.log(p.name+\"\\t\"+d)})}catch{}")'

# Completion subcommands
complete -c oos -n '__fish_seen_subcommand_from completion' -a bash -d 'Bash completion'
complete -c oos -n '__fish_seen_subcommand_from completion' -a zsh -d 'Zsh completion'
complete -c oos -n '__fish_seen_subcommand_from completion' -a fish -d 'Fish completion'
complete -c oos -n '__fish_seen_subcommand_from completion' -a powershell -d 'PowerShell completion'

# Setup-completion subcommands
complete -c oos -n '__fish_seen_subcommand_from setup-completion' -a bash -d 'Bash'
complete -c oos -n '__fish_seen_subcommand_from setup-completion' -a zsh -d 'Zsh'
complete -c oos -n '__fish_seen_subcommand_from setup-completion' -a fish -d 'Fish'
complete -c oos -n '__fish_seen_subcommand_from setup-completion' -a powershell -d 'PowerShell'
`;
}

function generatePowerShellCompletion() {
  const script = `using namespace System.Management.Automation
using namespace System.Management.Automation.Language

Register-ArgumentCompleter -Native -CommandName 'oos' -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commandElements = $commandAst.CommandElements
    $tokens = @($commandElements | ForEach-Object { $_.Extent.Text })

    $actualTokens = @($tokens | Where-Object { $_ -ne '' })
    $tokenCount = $actualTokens.Count

    $topLevelCommands = @('profile', 'template', 'render', 'current', 'validate', 'init', 'completion', 'setup-completion', 'models')
    $profileSubcommands = @('list', 'ls', 'create', 'switch', 'use', 'delete', 'rm', 'copy', 'cp', 'rename', 'mv', 'show', 'edit', 'open', 'import', 'export')
    $profileNameSubcommands = @('switch', 'use', 'delete', 'rm', 'show', 'copy', 'cp', 'rename', 'mv', 'edit', 'open', 'export')

    if ($tokenCount -eq 1) {
        $topLevelCommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) }
        return
    }

    $command = $actualTokens[1]

    if ($command -notin $topLevelCommands) {
        $topLevelCommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) }
        return
    }

    if ($tokenCount -eq 2) {
        switch ($command) {
            'profile' { $profileSubcommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) } }
            'template' { @('list', 'ls', 'create', 'show') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) } }
            'completion' { @('bash', 'zsh', 'fish', 'powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) } }
            'setup-completion' { @('bash', 'zsh', 'fish', 'powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) } }
            'render' {
                $outputEncoding = [System.Text.Encoding]::UTF8
                [Console]::OutputEncoding = $outputEncoding
                $json = oos profile list --json 2>$null
                if ($json) {
                    try {
                        $profiles = $json | ConvertFrom-Json
                        $profiles | Where-Object { $_.name -like "$wordToComplete*" } | ForEach-Object {
                            $desc = $_.description
                            if ($_.isActive) { $desc = "$desc (active)" }
                            [CompletionResult]::new($_.name, $_.name, 'ParameterValue', $desc)
                        }
                    } catch {}
                }
            }
        }
        return
    }

    # tokenCount >= 3
    $subcommand = $actualTokens[2]

    switch ($command) {
        'profile' {
            # Partial subcommand - complete it
            if ($subcommand -notin $profileSubcommands) {
                $profileSubcommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) }
                return
            }
            # Complete profile names for specific subcommands
            if ($subcommand -in $profileNameSubcommands) {
                $outputEncoding = [System.Text.Encoding]::UTF8
                [Console]::OutputEncoding = $outputEncoding
                $json = oos profile list --json 2>$null
                if ($json) {
                    try {
                        $profiles = $json | ConvertFrom-Json
                        $profiles | Where-Object { $_.name -like "$wordToComplete*" } | ForEach-Object {
                            $desc = $_.description
                            if ($_.isActive) { $desc = "$desc (active)" }
                            [CompletionResult]::new($_.name, $_.name, 'ParameterValue', $desc)
                        }
                    } catch {}
                }
            }
            # For other subcommands (list, ls, create, import) - no completion needed
        }
        'template' {
            if ($subcommand -notin @('list', 'ls', 'create', 'show')) {
                @('list', 'ls', 'create', 'show') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [CompletionResult]::new($_, $_, 'ParameterValue', $_) }
                return
            }
            if ($subcommand -eq 'show') {
                $outputEncoding = [System.Text.Encoding]::UTF8
                [Console]::OutputEncoding = $outputEncoding
                $json = oos profile list --json 2>$null
                if ($json) {
                    try {
                        $profiles = $json | ConvertFrom-Json
                        $profiles | Where-Object { $_.name -like "$wordToComplete*" } | ForEach-Object {
                            [CompletionResult]::new($_.name, $_.name, 'ParameterValue', $_.description)
                        }
                    } catch {}
                }
            }
        }
        'render' {
            $outputEncoding = [System.Text.Encoding]::UTF8
            [Console]::OutputEncoding = $outputEncoding
            $json = oos profile list --json 2>$null
            if ($json) {
                try {
                    $profiles = $json | ConvertFrom-Json
                    $profiles | Where-Object { $_.name -like "$wordToComplete*" } | ForEach-Object {
                        [CompletionResult]::new($_.name, $_.name, 'ParameterValue', $_.description)
                    }
                } catch {}
            }
        }
    }
}`;

  return script;
}

export async function completionAction(shell) {
  const shells = {
    bash: generateBashCompletion,
    zsh: generateZshCompletion,
    fish: generateFishCompletion,
    powershell: generatePowerShellCompletion,
    pwsh: generatePowerShellCompletion,
  };

  if (!shell) {
    const detected = process.env.SHELL?.split('/').pop() || 'bash';
    shell = detected === 'zsh' ? 'zsh' : detected === 'fish' ? 'fish' : 'bash';
  }

  const generator = shells[shell];
  if (!generator) {
    console.error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish, powershell`);
    process.exit(1);
  }

  console.log(generator());
}

export {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  generatePowerShellCompletion,
};

export function registerCompletionCommand(program) {
  program
    .command('completion [shell]')
    .description('Generate shell completion script')
    .on('--help', () => {
      console.log('');
      console.log('Examples:');
      console.log('  # Bash - add to ~/.bashrc');
      console.log('  eval "$(oos completion bash)"');
      console.log('');
      console.log('  # Zsh - add to ~/.zshrc');
      console.log('  eval "$(oos completion zsh)"');
      console.log('');
      console.log('  # Fish');
      console.log('  oos completion fish > ~/.config/fish/completions/oos.fish');
      console.log('');
      console.log('  # PowerShell - save and source');
      console.log('  oos completion powershell > ~/.oos-completion.ps1');
      console.log('  Add to $PROFILE: . ~/.oos-completion.ps1');
    })
    .action(completionAction);
}
