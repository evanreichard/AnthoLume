import { useState } from 'react';
import { LoadingState, SegmentedControl } from '../components';
import { Link } from 'react-router-dom';
import { useGetHome } from '../generated/anthoLumeAPIV1';
import type { LeaderboardData, LeaderboardEntry, UserStreak } from '../generated/model';
import ReadingHistoryGraph from '../components/ReadingHistoryGraph';
import { formatNumber, formatDuration } from '../utils/formatters';
import { dataForStatus } from '../utils/apiResponses';

interface InfoCardProps {
  title: string;
  size: string | number;
  link?: string;
}

function InfoCard({ title, size, link }: InfoCardProps) {
  const content = (
    <div className="flex w-full gap-4 rounded bg-surface p-4 shadow-lg">
      <div className="flex w-full flex-col justify-around text-sm text-content">
        <p className="text-2xl font-bold">{size}</p>
        <p className="text-sm text-content-subtle">{title}</p>
      </div>
    </div>
  );

  if (link) {
    return (
      <Link to={link} className="w-full">
        {content}
      </Link>
    );
  }

  return <div className="w-full">{content}</div>;
}

interface StreakCardProps {
  streak: UserStreak;
}

function StreakCard({ streak }: StreakCardProps) {
  const isWeekly = streak.window === 'WEEK';

  return (
    <div className="w-full">
      <div className="relative w-full rounded bg-surface px-4 py-6 text-content shadow-lg">
        <p className="w-max border-b border-border text-sm font-semibold text-content-muted">
          {isWeekly ? 'Weekly Read Streak' : 'Daily Read Streak'}
        </p>
        <div className="my-6 flex items-end space-x-2">
          <p className="text-5xl font-bold">{streak.current_streak}</p>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between border-b border-border pb-2 text-sm">
            <div>
              <p>{isWeekly ? 'Current Weekly Streak' : 'Current Daily Streak'}</p>
              <div className="flex items-end text-sm text-content-subtle">
                {streak.current_streak_start_date} ➞ {streak.current_streak_end_date}
              </div>
            </div>
            <div className="flex items-end font-bold">{streak.current_streak}</div>
          </div>
          <div className="mb-2 flex items-center justify-between pb-2 text-sm">
            <div>
              <p>{isWeekly ? 'Best Weekly Streak' : 'Best Daily Streak'}</p>
              <div className="flex items-end text-sm text-content-subtle">
                {streak.max_streak_start_date} ➞ {streak.max_streak_end_date}
              </div>
            </div>
            <div className="flex items-end font-bold">{streak.max_streak}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LeaderboardCardProps {
  name: string;
  data: LeaderboardData;
}

type TimePeriod = 'all' | 'year' | 'month' | 'week';

function LeaderboardCard({ name, data }: LeaderboardCardProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('all');

  const formatValue = (value: number): string => {
    switch (name) {
      case 'WPM':
        return `${value.toFixed(2)} WPM`;
      case 'Duration':
        return formatDuration(value);
      case 'Words':
        return formatNumber(value);
      default:
        return value.toString();
    }
  };

  const currentData = data[selectedPeriod];

  return (
    <div className="w-full">
      <div className="flex size-full flex-col justify-between rounded bg-surface px-4 py-6 text-content shadow-lg">
        <div>
          <div className="flex justify-between">
            <p className="w-max border-b border-border text-sm font-semibold text-content-muted">
              {name} Leaderboard
            </p>
            <SegmentedControl<TimePeriod>
              variant="unstyled"
              className="flex items-center gap-2 text-xs"
              ariaLabel={`${name} leaderboard period`}
              value={selectedPeriod}
              onChange={setSelectedPeriod}
              buttonClassName="cursor-pointer"
              activeClassName="text-content"
              inactiveClassName="text-content-subtle hover:text-content"
              options={[
                { value: 'all', label: 'all' },
                { value: 'year', label: 'year' },
                { value: 'month', label: 'month' },
                { value: 'week', label: 'week' },
              ]}
            />
          </div>
        </div>

        <div className="my-6 flex items-end space-x-2">
          {currentData?.length === 0 ? (
            <p className="text-5xl font-bold">N/A</p>
          ) : (
            <p className="text-5xl font-bold">{currentData[0]?.user_id || 'N/A'}</p>
          )}
        </div>

        <div>
          {currentData?.slice(0, 3).map((item: LeaderboardEntry, index: number) => (
            <div
              key={item.user_id}
              className={`flex items-center justify-between py-2 text-sm ${index > 0 ? 'border-t border-border' : ''}`}
            >
              <div>
                <p>{item.user_id}</p>
              </div>
              <div className="flex items-end font-bold">{formatValue(item.value)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data: homeData, isLoading: homeLoading } = useGetHome();

  const homeResponse = dataForStatus(homeData, 200);
  const dbInfo = homeResponse?.database_info;
  const streaks = homeResponse?.streaks?.streaks;
  const graphData = homeResponse?.graph_data?.graph_data;
  const userStats = homeResponse?.user_statistics;

  if (homeLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="w-full">
        <div className="relative w-full rounded bg-surface shadow-lg">
          <p className="absolute left-5 top-3 w-max border-b border-border text-sm font-semibold text-content-muted">
            Daily Read Totals
          </p>
          <ReadingHistoryGraph data={graphData || []} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <InfoCard title="Documents" size={dbInfo?.documents_size || 0} link="./documents" />
        <InfoCard title="Activity Records" size={dbInfo?.activity_size || 0} link="./activity" />
        <InfoCard title="Progress Records" size={dbInfo?.progress_size || 0} link="./progress" />
        <InfoCard title="Devices" size={dbInfo?.devices_size || 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {streaks?.map((streak: UserStreak) => (
          <StreakCard key={streak.window} streak={streak} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <LeaderboardCard
          name="WPM"
          data={userStats?.wpm || { all: [], year: [], month: [], week: [] }}
        />
        <LeaderboardCard
          name="Duration"
          data={userStats?.duration || { all: [], year: [], month: [], week: [] }}
        />
        <LeaderboardCard
          name="Words"
          data={userStats?.words || { all: [], year: [], month: [], week: [] }}
        />
      </div>
    </div>
  );
}
