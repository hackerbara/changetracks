@slow @D-raw-mode-threads @wip
Feature: D-raw-mode-threads — Comment threads survive raw projection

  Regression gate for change-comments.ts projection guard (Task 14).
  The guard disposes threads when view.projection is 'decided' (final) or
  'original', but must leave threads intact when projection is 'none' (raw).

  Background:
    Given VS Code is launched with fixture "lifecycle-threads.md"
    And the extension has finished parsing

  @D-raw-mode-threads-01
  Scenario: Raw view retains comment threads
    Then the thread count is 3
    When I set view mode to "raw"
    Then the thread count is 3

  @D-raw-mode-threads-02
  Scenario: Final view disposes comment threads
    Then the thread count is 3
    When I set view mode to "final"
    Then the thread count is 0

  @D-raw-mode-threads-03
  Scenario: Switching raw then final disposes threads
    When I set view mode to "raw"
    Then the thread count is 3
    When I set view mode to "final"
    Then the thread count is 0

  @D-raw-mode-threads-04
  Scenario: Switching final then raw restores threads
    When I set view mode to "final"
    Then the thread count is 0
    When I set view mode to "raw"
    Then the thread count is 3
