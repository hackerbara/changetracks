@slow @D-delimiter-persistence @fixture(decoration-baseline-matrix)
Feature: Delimiter persistence across view switches
  As a reviewer with showDelimiters enabled
  I want delimiters to remain visible after switching away and back to working mode
  So the _userDisplay layer correctly preserves showDelimiters across view preset changes

  Background:
    Given I open "decoration-baseline-matrix.md" in VS Code
    And the ChangeDown extension is active
    And I wait for changes to load
    And the setting "showDelimiters" is true

  Scenario: Delimiters stay visible after switching away and back to working
    When I switch to "simple" view mode
    And I switch to "working" view mode
    Then delimiters are visible

  Scenario: Delimiters stay visible across all transitions starting from review
    When I switch to "simple" view mode
    And I switch to "final" view mode
    And I switch to "original" view mode
    And I switch to "all-markup" view mode
    Then delimiters are visible

  Scenario: Delimiters are hidden after switching away from review with showDelimiters false
    Given the setting "showDelimiters" is false
    When I switch to "simple" view mode
    And I switch to "all-markup" view mode
    Then delimiters are hidden via display:none
