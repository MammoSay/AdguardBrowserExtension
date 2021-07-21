/* eslint-disable
    react/jsx-props-no-spreading,
    jsx-a11y/no-static-element-interactions,
    jsx-a11y/click-events-have-key-events */
import React, {
    useCallback,
    useContext,
    useEffect,
    useState,
    useRef,
} from 'react';
import { observer } from 'mobx-react';
import cn from 'classnames';
import { FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import throttle from 'lodash/throttle';

import { rootStore } from '../../stores/RootStore';
import { getRequestEventType } from '../RequestWizard/utils';
import { reactTranslator } from '../../../../common/translators/reactTranslator';
import { ANTIBANNER_FILTERS_ID } from '../../../../common/constants';
import { FilteringEventsEmpty } from './FilteringEventsEmpty';
import { optionsStorage } from '../../../options/options-storage';
import { passiveEventSupported } from '../../../helpers';

import './filtering-events.pcss';
import { Status } from '../Status';
import { StatusMode, getStatusMode } from '../../filteringLogStatus';

const filterNameAccessor = (props) => {
    const {
        requestRule,
        filterName,
        stealthActions,
    } = props;

    if (requestRule && requestRule.isStealthModeRule) {
        return reactTranslator.getMessage('filtering_log_privacy_applied_rules');
    }

    if (!filterName && stealthActions) {
        return reactTranslator.getMessage('filtering_log_privacy_applied_rules');
    }

    return props.filterName;
};

/**
 * @typedef {Object} RowClassName
 * @property {string} YELLOW
 * @property {string} RED
 * @property {string} GREEN
 */
const RowClassName = {
    YELLOW: 'yellow',
    RED: 'red',
    GREEN: 'green',
};

const rowClassNameMap = {
    [StatusMode.REGULAR]: null,
    [StatusMode.MODIFIED]: RowClassName.YELLOW,
    [StatusMode.BLOCKED]: RowClassName.RED,
    [StatusMode.ALLOWED]: RowClassName.GREEN,
};

const getRowClassName = (event) => {
    const mode = getStatusMode(event);
    return rowClassNameMap[mode];
};

const urlAccessor = (props) => {
    const {
        requestUrl,
        cookieName,
        cookieValue,
        element,
    } = props;

    if (cookieName && cookieValue) {
        return `${cookieName} = ${cookieValue}`;
    }

    if (cookieName) {
        return `${cookieName}`;
    }

    if (element) {
        return element;
    }

    return requestUrl;
};

const typeAccessor = (props) => {
    return getRequestEventType(props);
};

const ruleAccessor = (props) => {
    const {
        requestRule,
        replaceRules,
    } = props;

    let ruleText = '';
    if (requestRule) {
        if (requestRule.filterId === ANTIBANNER_FILTERS_ID.ALLOWLIST_FILTER_ID) {
            ruleText = reactTranslator.getMessage('filtering_log_in_allowlist');
        } else {
            ruleText = requestRule.ruleText;
        }
    }

    if (replaceRules) {
        const rulesCount = replaceRules.length;
        ruleText = `${reactTranslator.getMessage('filtering_log_modified_rules')} ${rulesCount}`;
    }

    return ruleText;
};

const statusAccessor = (props) => {
    return (
        <Status {...props} />
    );
};

const Row = observer(({
    event,
    columns,
    onClick,
    style,
}) => {
    return (
        <div
            style={style}
            id={event.eventId}
            onClick={onClick}
            className={cn('tr', getRowClassName(event))}
        >
            {
                columns.map((column) => {
                    const { accessor } = column;
                    let cellContent;
                    if (typeof accessor === 'string') {
                        cellContent = event[accessor];
                    } else {
                        cellContent = accessor(event);
                    }

                    return (
                        <div
                            className="td"
                            key={column.id}
                            style={{ width: column.getWidth() }}
                        >
                            {cellContent}
                        </div>
                    );
                })
            }
        </div>
    );
});

const VirtualizedRow = ({
    index,
    style,
    data,
}) => {
    const { events, columns, handleRowClick } = data;
    const event = events[index];

    return (
        <Row
            event={event}
            columns={columns}
            onClick={handleRowClick}
            style={style}
        />
    );
};

const ITEM_HEIGHT_PX = 30;
const FilteringEventsRows = observer(({
    logStore,
    columns,
    handleRowClick,
}) => {
    const { events } = logStore;
    return (
        <AutoSizer>
            {({
                height,
                width,
            }) => {
                return (
                    <FixedSizeList
                        className="list"
                        height={height}
                        itemCount={events.length}
                        itemData={{
                            events,
                            columns,
                            handleRowClick,
                        }}
                        itemSize={ITEM_HEIGHT_PX}
                        width={width}
                    >
                        {VirtualizedRow}
                    </FixedSizeList>
                );
            }}
        </AutoSizer>
    );
});

const FilteringEvents = observer(() => {
    const { logStore } = useContext(rootStore);

    const tableRef = useRef(null);

    const handleRowClick = useCallback((e) => {
        const { id } = e.currentTarget;
        logStore.setSelectedEventById(id);
    }, []);

    const columnsData = [
        {
            id: 'status',
            Header: `${reactTranslator.getMessage('filtering_table_status')}`,
            accessor: statusAccessor,
        },
        {
            id: 'url',
            Header: 'URL',
            accessor: urlAccessor,
        },
        {
            id: 'type',
            Header: `${reactTranslator.getMessage('filtering_table_type')}`,
            accessor: typeAccessor,
        },
        {
            id: 'rule',
            Header: `${reactTranslator.getMessage('filtering_table_rule')}`,
            accessor: ruleAccessor,
        },
        {
            id: 'filter',
            Header: `${reactTranslator.getMessage('filtering_table_filter')}`,
            accessor: filterNameAccessor,
        },
        {
            id: 'source',
            Header: `${reactTranslator.getMessage('filtering_table_source')}`,
            accessor: 'frameDomain',
        },
    ];

    let columnsWidths = optionsStorage.getItem(optionsStorage.KEYS.COLUMNS_WIDTHS);
    if (!columnsWidths || columnsWidths.length !== columnsData.length) {
        columnsWidths = new Array(columnsData.length).fill(1 / columnsData.length);
    }
    const [relativeColumnWidths, setRelativeColumnSizes] = useState(columnsWidths);

    useEffect(() => {
        optionsStorage.setItem(optionsStorage.KEYS.COLUMNS_WIDTHS, relativeColumnWidths);
    }, [relativeColumnWidths]);

    let startClientX = null;
    let tableClientWidth = null;
    const dispatchMove = throttle((clientX, columnIndex) => {
        const MIN_COLUMN_WIDTH = 50;
        const columnWidth = tableClientWidth * relativeColumnWidths[columnIndex];
        const leafColumnWidth = tableClientWidth * relativeColumnWidths[columnIndex + 1];
        const columnsWidthSum = columnWidth + leafColumnWidth;

        const deltaX = startClientX - clientX;
        const newColumnWidth = columnWidth - deltaX;

        if (newColumnWidth < MIN_COLUMN_WIDTH
            || newColumnWidth > columnsWidthSum - MIN_COLUMN_WIDTH) {
            return;
        }

        const newNextColumnWidth = columnsWidthSum - newColumnWidth;

        if (newColumnWidth + newNextColumnWidth > columnWidth + leafColumnWidth) {
            return;
        }

        const newColumnRelativeWidth = newColumnWidth / tableClientWidth;

        // eslint-disable-next-line max-len
        const newNextColumnRelativeWidth = newNextColumnWidth / tableClientWidth;

        setRelativeColumnSizes((prevSizesRelation) => {
            const newSizesRelation = [...prevSizesRelation];
            newSizesRelation[columnIndex] = newColumnRelativeWidth;
            newSizesRelation[columnIndex + 1] = newNextColumnRelativeWidth;
            return newSizesRelation;
        });
    }, 20);

    const dispatchMovingStarted = (clientX) => {
        startClientX = clientX;
        tableClientWidth = tableRef.current.getBoundingClientRect().width;
        // fixes cursor blinking and text selection
        document.body.classList.add('col-resize');
    };

    const dispatchEnd = () => {
        startClientX = null;
        tableClientWidth = null;
        // clear after dragging end
        document.body.classList.remove('col-resize');
    };

    const onResizeStart = (e, columnIndex) => {
        let isTouchEvent = false;
        if (e.type === 'touchstart') {
            // lets not respond to multiple touches (e.g. 2 or 3 fingers)
            if (e.touches && e.touches.length > 1) {
                return;
            }
            isTouchEvent = true;
        }

        const clientX = isTouchEvent ? Math.round(e.touches[0].clientX) : e.clientX;

        const handlersAndEvents = {
            mouse: {
                moveEvent: 'mousemove',
                // eslint-disable-next-line no-shadow
                moveHandler: (e) => dispatchMove(e.clientX, columnIndex),
                upEvent: 'mouseup',
                upHandler: () => {
                    document.removeEventListener(
                        'mousemove',
                        handlersAndEvents.mouse.moveHandler,
                    );
                    document.removeEventListener(
                        'mouseup',
                        handlersAndEvents.mouse.upHandler,
                    );
                    dispatchEnd();
                },
            },
            touch: {
                moveEvent: 'touchmove',
                // eslint-disable-next-line no-shadow
                moveHandler: (e) => {
                    if (e.cancelable) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    dispatchMove(e.touches[0].clientX, columnIndex);
                    return false;
                },
                upEvent: 'touchend',
                upHandler: () => {
                    document.removeEventListener(
                        handlersAndEvents.touch.moveEvent,
                        handlersAndEvents.touch.moveHandler,
                    );
                    document.removeEventListener(
                        handlersAndEvents.touch.upEvent,
                        handlersAndEvents.touch.moveHandler,
                    );
                    dispatchEnd();
                },
            },
        };

        const events = isTouchEvent
            ? handlersAndEvents.touch
            : handlersAndEvents.mouse;
        const passiveIfSupported = passiveEventSupported()
            ? { passive: false }
            : false;
        document.addEventListener(
            events.moveEvent,
            events.moveHandler,
            passiveIfSupported,
        );
        document.addEventListener(
            events.upEvent,
            events.upHandler,
            passiveIfSupported,
        );

        dispatchMovingStarted(clientX);
    };

    const getResizerProps = (columnIndex) => {
        return {
            onMouseDown: (e) => onResizeStart(e, columnIndex),
            onTouchStart: (e) => onResizeStart(e, columnIndex),
        };
    };

    const addMethods = (columns) => {
        return columns.map((column, idx) => {
            return {
                ...column,
                getWidth: () => {
                    return `${relativeColumnWidths[idx] * 100}%`;
                },
                getResizerProps: () => {
                    return getResizerProps(idx);
                },
            };
        });
    };

    const columns = addMethods(columnsData);

    return (
        <div className="filtering-log">
            <div className="table filtering-log__inner" ref={tableRef}>
                <div className="thead">
                    <div className="tr">
                        {
                            columns.map((column, idx) => (
                                <div
                                    className="th"
                                    key={column.id}
                                    style={{ width: column.getWidth() }}
                                >
                                    {column.Header}
                                    {
                                        idx < columns.length - 1
                                                && (
                                                    <div
                                                        role="separator"
                                                        className="resizer"
                                                        key={column.id}
                                                        style={{ cursor: 'col-resize' }}
                                                        {...column.getResizerProps()}
                                                    />
                                                )
                                    }
                                </div>
                            ))
                        }
                    </div>
                </div>
                <div className="tbody" style={{ height: '100%' }}>
                    <FilteringEventsRows
                        logStore={logStore}
                        handleRowClick={handleRowClick}
                        columns={columns}
                    />
                    <FilteringEventsEmpty />
                </div>
            </div>
        </div>
    );
});

export { FilteringEvents };
