import { useState } from 'react';
import { useDemo } from './DemoState';
import { Link } from './navigation';
import { PageHeading } from './ui';

const activity = [
  ['Today, 08:20', 'The Tidal Atlas', '18 min', 'Browser'],
  ['Yesterday, 20:10', 'Ordinary Light', '24 min', 'KOReader'],
  ['Monday, 07:45', 'The Tidal Atlas', '12 min', 'Browser'],
];
export function Insights() {
  const { signedIn } = useDemo();
  const [view, setView] = useState('overview');
  return (
    <>
      <PageHeading eyebrow="A rhythm, not a race" title="Reading insights" />
      {!signedIn ? (
        <div className="empty-state">
          <h2>Account insights are hidden.</h2>
          <p>Local-only reading never creates server activity.</p>
          <Link className="button" to="/more">
            Sign in to demo account
          </Link>
        </div>
      ) : (
        <>
          <p className="scope-note">
            Synthetic statistics · example week · UTC · illustrative snapshot, not live. No
            local-only reading included.
          </p>
          <div className="segmented insights-tabs" aria-label="Insight view">
            {[
              ['overview', 'Overview'],
              ['activity', 'Activity'],
              ['devices', 'Device progress'],
            ].map(([key, label]) => (
              <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
                {label}
              </button>
            ))}
          </div>
          {view === 'overview' && (
            <>
              <section className="insight-stats">
                <div>
                  <p className="eyebrow">Reading this week</p>
                  <strong>
                    2<small>h</small> 18<small>m</small>
                  </strong>
                  <span>Illustrative credited reading time</span>
                </div>
                <div>
                  <p className="eyebrow">Pages read</p>
                  <strong>96</strong>
                  <span>Existing measurement rules</span>
                </div>
                <div>
                  <p className="eyebrow">Current streak</p>
                  <strong>
                    4<small> days</small>
                  </strong>
                  <span>Synthetic consecutive days</span>
                </div>
              </section>
              <section className="chart-panel">
                <div className="section-label">
                  <h2>A little, often</h2>
                  <span>Example week · UTC</span>
                </div>
                <div
                  className="bar-chart"
                  role="img"
                  aria-label="Illustrative minutes by day: Monday 12, Tuesday 24, Wednesday 18, Thursday 0, Friday 30, Saturday 36, Sunday 18."
                >
                  {[12, 24, 18, 0, 30, 36, 18].map((minutes, index) => (
                    <div key={index}>
                      <span>{minutes}</span>
                      <i style={{ height: `${Math.max(minutes * 4, 3)}px` }} />
                      <b>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</b>
                    </div>
                  ))}
                </div>
              </section>
              <section className="leaderboard">
                <div className="section-label">
                  <h2>Alongside you</h2>
                  <span>Shared leaderboard · example 7 days</span>
                </div>
                <ol>
                  {[
                    ['Mara Finch', '3h 10m'],
                    ['Alex Rowan', '2h 18m'],
                    ['Sam Reed', '1h 42m'],
                  ].map(([name, time]) => (
                    <li key={name}>
                      <span>
                        {name}
                        <small>Synthetic reader</small>
                      </span>
                      <b>{time}</b>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
          {view === 'activity' && (
            <section className="data-panel">
              <h2>Reading activity</h2>
              <p>Representative accepted activity, not an append-only progress history.</p>
              <table>
                <caption className="sr-only">Synthetic activity in UTC</caption>
                <thead>
                  <tr>
                    <th>When · UTC</th>
                    <th>Book / device</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map(([when, title, time, device]) => (
                    <tr key={when}>
                      <td>{when}</td>
                      <td>
                        {title}
                        <small>{device}</small>
                      </td>
                      <td>{time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {view === 'devices' && (
            <section className="data-panel">
              <h2>Current device snapshots</h2>
              <p>
                These are current positions, not historical events. No device-management operations
                are added.
              </p>
              <table>
                <caption className="sr-only">Synthetic per-device positions</caption>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Book</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Browser</td>
                    <td>The Tidal Atlas</td>
                    <td>24%</td>
                  </tr>
                  <tr>
                    <td>KOReader</td>
                    <td>The Tidal Atlas</td>
                    <td>41%</td>
                  </tr>
                </tbody>
              </table>
              <Link to="/sync?state=conflict">Review the different positions →</Link>
            </section>
          )}
          <p className="small muted">
            Initial forward-page-turn/WPM credit rules are preserved. Sample navigation, idle time,
            and chapter jumps in this prototype generate no activity.
          </p>
        </>
      )}
    </>
  );
}
