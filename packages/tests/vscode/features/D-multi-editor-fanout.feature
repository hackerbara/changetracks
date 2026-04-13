@wip @slow @D-multi-editor-fanout @fixture(decoration-baseline-matrix)
Feature: Multi-editor view fan-out
  As a developer with documents open in a split-view layout
  I want setView and setDisplay to apply to all visible editors
  So that switching view modes or display settings affects every editor pane

  Background:
    Given I open "decoration-baseline-matrix.md" in VS Code
    And the ChangeDown extension is active
    And I wait for changes to load
    And a second tracked markdown is open in the right editor split

  # ── setView fan-out ───────────────────────────────────────────

  Scenario: D-MEFAN-01 setView fans out to both split editors
    When I switch to "simple" view mode
    Then the left editor has hidden delimiters
    And the right editor has hidden delimiters

  # ── setDisplay fan-out ────────────────────────────────────────

  Scenario: D-MEFAN-02 setDisplay via showDelimiters config fans out to both editors
    When I set "showDelimiters" to false
    Then the left editor has hidden delimiters
    And the right editor has hidden delimiters
